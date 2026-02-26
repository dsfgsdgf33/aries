import { NextRequest } from 'next/server';
import OpenAI from 'openai';

const MAX_WELLS = 5000;
const MAX_BYTES = 15_000_000;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'queryWells',
      description: 'Query wells by operator, county, status, wellType, formation, or field. Returns matching wells.',
      parameters: {
        type: 'object',
        properties: {
          operator: { type: 'string', description: 'Filter by operator name (partial match)' },
          county: { type: 'string', description: 'Filter by county name' },
          status: { type: 'string', description: 'Filter by status: Producing, Shut-in, DUC, Drilling, P&A' },
          wellType: { type: 'string', description: 'Filter by type: Oil, Gas, Other' },
          formation: { type: 'string', description: 'Filter by formation name (partial match)' },
          field: { type: 'string', description: 'Filter by field name (partial match)' },
          limit: { type: 'number', description: 'Max results to return (default 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'aggregateProduction',
      description: 'Aggregate production totals grouped by a field (operator, county, formation, field, status, wellType).',
      parameters: {
        type: 'object',
        properties: {
          groupBy: { type: 'string', description: 'Field to group by: operator, county, formation, field, status, wellType' },
          metric: { type: 'string', description: 'Metric: wellCount, totalOil, totalGas, avgOil, avgGas' },
          limit: { type: 'number', description: 'Top N results (default 10)' },
        },
        required: ['groupBy'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rankWells',
      description: 'Rank wells by a metric (totalOil, totalGas, monthsProducing). Returns top/bottom N.',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', description: 'Metric to rank by: totalOil, totalGas, monthsProducing' },
          order: { type: 'string', description: 'asc or desc (default desc)' },
          limit: { type: 'number', description: 'Number of results (default 10)' },
          county: { type: 'string', description: 'Optional county filter' },
          operator: { type: 'string', description: 'Optional operator filter' },
        },
        required: ['metric'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculateSpacing',
      description: 'Calculate well spacing statistics for a given county or operator.',
      parameters: {
        type: 'object',
        properties: {
          county: { type: 'string' },
          operator: { type: 'string' },
        },
      },
    },
  },
];

function executeTool(name: string, args: Record<string, any>, wells: any[]): any {
  const matchStr = (val: string | undefined, filter: string) =>
    val ? val.toLowerCase().includes(filter.toLowerCase()) : false;

  const getTotal = (w: any, field: string) => {
    if (!w.production || !Array.isArray(w.production)) return 0;
    return w.production.reduce((s: number, p: any) => s + (p[field] || 0), 0);
  };

  if (name === 'queryWells') {
    let results = [...wells];
    if (args.operator) results = results.filter(w => matchStr(w.operator, args.operator));
    if (args.county) results = results.filter(w => matchStr(w.county, args.county));
    if (args.status) results = results.filter(w => matchStr(w.status, args.status));
    if (args.wellType) results = results.filter(w => matchStr(w.wellType, args.wellType));
    if (args.formation) results = results.filter(w => matchStr(w.formation, args.formation));
    if (args.field) results = results.filter(w => matchStr(w.field, args.field));
    const limit = args.limit || 20;
    return {
      total: results.length,
      wells: results.slice(0, limit).map(w => ({
        apiNumber: w.apiNumber,
        wellName: w.wellName,
        operator: w.operator,
        county: w.county,
        status: w.status,
        wellType: w.wellType,
        formation: w.formation,
        field: w.field,
        totalOil: getTotal(w, 'oilBbl'),
        totalGas: getTotal(w, 'gasMcf'),
      })),
    };
  }

  if (name === 'aggregateProduction') {
    const groupBy = args.groupBy || 'operator';
    const groups: Record<string, { count: number; oil: number; gas: number }> = {};
    wells.forEach(w => {
      const key = (w as any)[groupBy] || 'Unknown';
      if (!groups[key]) groups[key] = { count: 0, oil: 0, gas: 0 };
      groups[key].count++;
      groups[key].oil += getTotal(w, 'oilBbl');
      groups[key].gas += getTotal(w, 'gasMcf');
    });
    const sorted = Object.entries(groups)
      .map(([k, v]) => ({ [groupBy]: k, wellCount: v.count, totalOil: v.oil, totalGas: v.gas, avgOil: Math.round(v.oil / v.count), avgGas: Math.round(v.gas / v.count) }))
      .sort((a, b) => b.wellCount - a.wellCount)
      .slice(0, args.limit || 10);
    return sorted;
  }

  if (name === 'rankWells') {
    let results = [...wells];
    if (args.county) results = results.filter(w => matchStr(w.county, args.county));
    if (args.operator) results = results.filter(w => matchStr(w.operator, args.operator));
    
    const metricFn = (w: any) => {
      if (args.metric === 'totalOil') return getTotal(w, 'oilBbl');
      if (args.metric === 'totalGas') return getTotal(w, 'gasMcf');
      if (args.metric === 'monthsProducing') return w.production?.length || 0;
      return 0;
    };

    results.sort((a, b) => args.order === 'asc' ? metricFn(a) - metricFn(b) : metricFn(b) - metricFn(a));
    return results.slice(0, args.limit || 10).map(w => ({
      apiNumber: w.apiNumber,
      wellName: w.wellName,
      operator: w.operator,
      county: w.county,
      [args.metric]: metricFn(w),
    }));
  }

  if (name === 'calculateSpacing') {
    let results = wells.filter(w => w.latitude && w.longitude);
    if (args.county) results = results.filter(w => matchStr(w.county, args.county));
    if (args.operator) results = results.filter(w => matchStr(w.operator, args.operator));

    if (results.length < 2) return { message: 'Not enough wells with coordinates for spacing calc', wellCount: results.length };

    const distances: number[] = [];
    for (let i = 0; i < Math.min(results.length, 50); i++) {
      let minDist = Infinity;
      for (let j = 0; j < results.length; j++) {
        if (i === j) continue;
        const dlat = (results[i].latitude - results[j].latitude) * 364000;
        const dlng = (results[i].longitude - results[j].longitude) * 311000;
        const d = Math.sqrt(dlat * dlat + dlng * dlng);
        if (d < minDist) minDist = d;
      }
      if (minDist < Infinity) distances.push(minDist);
    }
    distances.sort((a, b) => a - b);
    return {
      wellCount: results.length,
      avgSpacingFt: Math.round(distances.reduce((s, d) => s + d, 0) / distances.length),
      minSpacingFt: Math.round(distances[0]),
      maxSpacingFt: Math.round(distances[distances.length - 1]),
      medianSpacingFt: Math.round(distances[Math.floor(distances.length / 2)]),
    };
  }

  return { error: 'Unknown tool' };
}

export async function POST(req: NextRequest) {
  try {
    const contentLength = parseInt(req.headers.get('content-length') || '0');
    if (contentLength > MAX_BYTES) {
      return Response.json(
        { error: 'payload_too_large', maxWells: MAX_WELLS, maxBytes: MAX_BYTES, suggestion: 'Reduce scope: filter by county/formation/operator or query fewer wells before chatting.' },
        { status: 413 }
      );
    }

    const body = await req.json();
    const { messages, wells } = body;

    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: 'messages array required' }, { status: 400 });
    }

    if (wells && wells.length > MAX_WELLS) {
      return Response.json(
        { error: 'payload_too_large', maxWells: MAX_WELLS, maxBytes: MAX_BYTES, suggestion: 'Reduce scope: filter by county/formation/operator or query fewer wells before chatting.' },
        { status: 413 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Return a helpful simulated response when no API key
      const lastMsg = messages[messages.length - 1]?.content || '';
      const wellData = wells || [];
      
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const send = (obj: any) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));

          send({ type: 'meta', wellCount: wellData.length, model: 'local-fallback' });

          // Execute a tool based on the query
          let toolName = 'queryWells';
          let toolArgs: any = { limit: 10 };
          const q = lastMsg.toLowerCase();

          if (q.includes('top') || q.includes('rank') || q.includes('best')) {
            toolName = 'rankWells';
            toolArgs = { metric: q.includes('gas') ? 'totalGas' : 'totalOil', limit: 10 };
          } else if (q.includes('aggregate') || q.includes('group') || q.includes('by operator') || q.includes('by county')) {
            toolName = 'aggregateProduction';
            toolArgs = { groupBy: q.includes('county') ? 'county' : 'operator' };
          } else if (q.includes('spacing')) {
            toolName = 'calculateSpacing';
            toolArgs = {};
          } else if (q.includes('shut-in') || q.includes('shut in')) {
            toolArgs = { status: 'Shut-in', limit: 20 };
          } else if (q.includes('producing')) {
            toolArgs = { status: 'Producing', limit: 20 };
          }

          // Check for operator/county mentions
          const operators = ['diamondback', 'eog', 'pioneer', 'occidental', 'devon', 'apache', 'chevron', 'conocophillips', 'mewbourne', 'permian resources', 'matador', 'coterra', 'caza', 'centennial', 'ring energy'];
          for (const op of operators) {
            if (q.includes(op)) { toolArgs.operator = op; break; }
          }
          const counties = ['midland', 'martin', 'howard', 'reeves', 'loving', 'ward', 'pecos', 'ector', 'crane', 'upton', 'glasscock', 'reagan', 'winkler', 'andrews'];
          for (const c of counties) {
            if (q.includes(c)) { toolArgs.county = c; break; }
          }

          send({ type: 'tool_call', name: toolName, arguments: toolArgs });
          const result = executeTool(toolName, toolArgs, wellData);
          send({ type: 'tool_result', name: toolName, result });

          // Generate summary
          let summary = '';
          if (toolName === 'queryWells') {
            const r = result as any;
            summary = `Found ${r.total} wells matching your query. Here are the top results:\n\n`;
            r.wells?.forEach((w: any, i: number) => {
              summary += `${i + 1}. **${w.wellName}** — ${w.operator} (${w.county} Co.) — ${w.status} — Oil: ${(w.totalOil / 1000).toFixed(1)}K bbl, Gas: ${(w.totalGas / 1000).toFixed(1)}K mcf\n`;
            });
          } else if (toolName === 'aggregateProduction') {
            summary = `Production aggregated by ${toolArgs.groupBy}:\n\n`;
            (result as any[]).forEach((r: any, i: number) => {
              summary += `${i + 1}. **${r[toolArgs.groupBy]}** — ${r.wellCount} wells — Oil: ${(r.totalOil / 1000).toFixed(1)}K bbl — Gas: ${(r.totalGas / 1000).toFixed(1)}K mcf\n`;
            });
          } else if (toolName === 'rankWells') {
            summary = `Top wells ranked by ${toolArgs.metric}:\n\n`;
            (result as any[]).forEach((r: any, i: number) => {
              summary += `${i + 1}. **${r.wellName}** — ${r.operator} (${r.county} Co.) — ${toolArgs.metric}: ${((r[toolArgs.metric] || 0) / 1000).toFixed(1)}K\n`;
            });
          } else if (toolName === 'calculateSpacing') {
            const r = result as any;
            summary = r.message || `Well spacing analysis: ${r.wellCount} wells analyzed.\nAvg spacing: ${r.avgSpacingFt} ft\nMin: ${r.minSpacingFt} ft\nMax: ${r.maxSpacingFt} ft\nMedian: ${r.medianSpacingFt} ft`;
          }

          // Stream tokens
          for (const char of summary) {
            send({ type: 'token', token: char });
          }

          send({ type: 'done' });
          controller.close();
        }
      });

      return new Response(stream, {
        headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
      });
    }

    // Real OpenAI call
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });

    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const wellData = wells || [];

    const systemPrompt = `You are the Permian AAS Studio AI assistant. You help analyze oil & gas well data from the Permian Basin.
You have access to ${wellData.length} wells. Use the provided tools for quantitative answers. Do not guess data - always use tools.
Summarize assumptions, filters used, and metric definitions in your responses.`;

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (obj: any) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));

        send({ type: 'meta', wellCount: wellData.length, model });

        try {
          const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
            ...messages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ];

          let response = await client.chat.completions.create({
            model,
            messages: chatMessages,
            tools,
            stream: true,
          });

          let currentToolCall: { id: string; name: string; args: string } | null = null;

          for await (const chunk of response) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              send({ type: 'token', token: delta.content });
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  currentToolCall = { id: tc.id || '', name: tc.function.name, args: '' };
                }
                if (tc.function?.arguments && currentToolCall) {
                  currentToolCall.args += tc.function.arguments;
                }
              }
            }

            if (chunk.choices[0]?.finish_reason === 'tool_calls' && currentToolCall) {
              const args = JSON.parse(currentToolCall.args || '{}');
              send({ type: 'tool_call', name: currentToolCall.name, arguments: args });
              const result = executeTool(currentToolCall.name, args, wellData);
              send({ type: 'tool_result', name: currentToolCall.name, result });

              // Continue conversation with tool result
              chatMessages.push({
                role: 'assistant',
                content: null,
                tool_calls: [{ id: currentToolCall.id, type: 'function', function: { name: currentToolCall.name, arguments: currentToolCall.args } }],
              } as any);
              chatMessages.push({
                role: 'tool',
                tool_call_id: currentToolCall.id,
                content: JSON.stringify(result),
              } as any);

              const followUp = await client.chat.completions.create({
                model,
                messages: chatMessages,
                tools,
                stream: true,
              });

              for await (const chunk2 of followUp) {
                if (chunk2.choices[0]?.delta?.content) {
                  send({ type: 'token', token: chunk2.choices[0].delta.content });
                }
              }

              currentToolCall = null;
            }
          }
        } catch (e: any) {
          send({ type: 'error', message: e.message || 'OpenAI error' });
        }

        send({ type: 'done' });
        controller.close();
      }
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
