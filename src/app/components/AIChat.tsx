'use client';
import { useState, useRef, useEffect } from 'react';

interface ChatMsg {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<Record<string, any>>;
  toolResults?: Array<Record<string, any>>;
}

interface Well {
  apiNumber: string;
  wellName: string;
  operator: string;
  county: string;
  [key: string]: any;
}

export default function AIChat({ wells }: { wells: Well[] }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMsg = { role: 'user', content: input.trim() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const payload = {
        messages: newMsgs.map(m => ({ role: m.role, content: m.content })),
        wells: wells.slice(0, 500).map(w => ({
          apiNumber: w.apiNumber,
          wellName: w.wellName,
          operator: w.operator,
          county: w.county,
          status: w.status,
          wellType: w.wellType,
          formation: w.formation,
          field: w.field,
          latitude: w.latitude,
          longitude: w.longitude,
        })),
      };

      const bodyStr = JSON.stringify(payload);
      if (bodyStr.length > 15_000_000) {
        setError('Payload too large. Filter to fewer wells before chatting.');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/data-model/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      });

      if (res.status === 413) {
        const err = await res.json();
        setError(err.suggestion || 'Payload too large. Reduce scope.');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(`Server error: ${res.status}`);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { setError('No response stream'); setLoading(false); return; }

      const decoder = new TextDecoder();
      let assistantContent = '';
      let toolCalls: Array<Record<string, any>> = [];
      let toolResults: Array<Record<string, any>> = [];
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'token') {
              assistantContent += evt.token;
              setMessages([...newMsgs, { role: 'assistant', content: assistantContent, toolCalls, toolResults }]);
            } else if (evt.type === 'tool_call') {
              toolCalls = [...toolCalls, { name: evt.name, args: evt.arguments }];
              setMessages([...newMsgs, { role: 'assistant', content: assistantContent, toolCalls, toolResults }]);
            } else if (evt.type === 'tool_result') {
              toolResults = [...toolResults, { name: evt.name, result: evt.result }];
              setMessages([...newMsgs, { role: 'assistant', content: assistantContent, toolCalls, toolResults }]);
            } else if (evt.type === 'error') {
              setError(evt.message || 'AI error');
            }
          } catch {}
        }
      }

      if (assistantContent || toolCalls.length) {
        setMessages([...newMsgs, { role: 'assistant', content: assistantContent, toolCalls, toolResults }]);
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    }
    setLoading(false);
  };

  const prompts = [
    'Top 5 operators by well count',
    'Which counties have the most producing wells?',
    'Average production by formation',
    'Show me all shut-in wells',
  ];

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-lg border border-slate-700">
      {/* Header */}
      <div className="p-3 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-sm font-semibold text-white">AI Query</span>
          <span className="text-xs text-slate-500">({wells.length} wells loaded)</span>
        </div>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} className="text-xs text-slate-400 hover:text-white">Clear</button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 400 }}>
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-slate-400 text-sm mb-4">Ask questions about your well data</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {prompts.map(p => (
                <button
                  key={p}
                  onClick={() => { setInput(p); }}
                  className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-full text-xs text-slate-300 hover:border-cyan-500 hover:text-cyan-400 transition"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              m.role === 'user' 
                ? 'bg-cyan-600 text-white' 
                : 'bg-slate-800 text-slate-200 border border-slate-700'
            }`}>
              {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="mt-2 space-y-1">
                  {m.toolCalls.map((tc: any, j: number) => (
                    <details key={j} className="bg-slate-900 rounded p-2 border border-slate-600">
                      <summary className="text-xs text-cyan-400 cursor-pointer">
                        🔧 {tc.name}({JSON.stringify(tc.args).slice(0, 60)}...)
                      </summary>
                      <pre className="text-xs text-slate-400 mt-1 overflow-x-auto">{JSON.stringify(tc.args, null, 2)}</pre>
                      {m.toolResults && m.toolResults[j] && (
                        <pre className="text-xs text-emerald-400 mt-1 overflow-x-auto">
                          {JSON.stringify(m.toolResults[j].result, null, 2).slice(0, 500)}
                        </pre>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
          ⚠️ {error}
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-white">×</button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-slate-700">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            placeholder="Ask about your wells..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
