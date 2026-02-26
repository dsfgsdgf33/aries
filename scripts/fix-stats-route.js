
const fs = require('fs');
const code = `import { NextResponse } from 'next/server';
import { generateRealWells, getRealWellStats } from '@/lib/data/real-well-database';

export async function GET() {
  try {
    const wells = generateRealWells();
    const base = getRealWellStats();

    const byCounty: Record<string, number> = {};
    const byOperator: Record<string, number> = {};
    let totalCumOil = 0;
    let totalCumGas = 0;

    for (const w of wells) {
      byCounty[w.county] = (byCounty[w.county] || 0) + 1;
      byOperator[w.operator] = (byOperator[w.operator] || 0) + 1;
      totalCumOil += w.cumOil || 0;
      totalCumGas += w.cumGas || 0;
    }

    const topCounties = Object.entries(byCounty)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const topOperators = Object.entries(byOperator)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const totalFormations = new Set(wells.map(w => w.formation)).size;

    return NextResponse.json({
      ...base,
      totalFormations,
      totalCumOil,
      totalCumGas,
      avgCumOil: wells.length ? Math.round(totalCumOil / wells.length) : 0,
      avgCumGas: wells.length ? Math.round(totalCumGas / wells.length) : 0,
      byCounty,
      byOperator,
      topCounties,
      topOperators,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
`;
fs.writeFileSync('app/api/stats/route.ts', code);
console.log('Stats route written:', code.length, 'chars');
