import { useMemo, useState } from "react";

interface RoiCalculatorProps {
  totalEstimatedWaste: number;
}

/**
 * Turns `total_estimated_waste` into a monthly recovered-spend and payback
 * figure (WP-J spec — Screens). All numbers shown are *projections*, never
 * verified outcomes — the labels make that clear.
 */
export function RoiCalculator({ totalEstimatedWaste }: RoiCalculatorProps): JSX.Element {
  const [recoveryRate, setRecoveryRate] = useState(0.5);
  const [monthlyFee, setMonthlyFee] = useState(2000);

  const projections = useMemo(() => {
    const periodDays = 10; // The audit window — fixture default is 10 days.
    const recoveredPerDay = (totalEstimatedWaste * recoveryRate) / periodDays;
    const monthlyRecovered = recoveredPerDay * 30;
    const annualRecovered = recoveredPerDay * 365;
    const paybackMonths = monthlyFee > 0 ? monthlyFee / Math.max(monthlyRecovered, 1) : null;
    return {
      monthlyRecovered,
      annualRecovered,
      paybackMonths,
    };
  }, [totalEstimatedWaste, recoveryRate, monthlyFee]);

  return (
    <section
      data-testid="roi-calculator"
      className="bg-white border border-slate-200 rounded-lg p-4"
    >
      <header className="mb-3">
        <h3 className="font-semibold text-sm">ROI calculator</h3>
        <p className="text-xs text-slate-500">
          Projection only — turns identified waste into recovered spend.
        </p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <label className="text-xs text-slate-600 flex flex-col gap-1">
          Recovery rate ({Math.round(recoveryRate * 100)}%)
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={recoveryRate}
            onChange={(e) => setRecoveryRate(Number(e.currentTarget.value))}
            className="w-full"
          />
        </label>
        <label className="text-xs text-slate-600 flex flex-col gap-1">
          Monthly fee ($)
          <input
            type="number"
            min={0}
            step={100}
            value={monthlyFee}
            onChange={(e) => setMonthlyFee(Number(e.currentTarget.value))}
            className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
          />
        </label>
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <Stat label="Identified waste (window)" value={`$${totalEstimatedWaste.toLocaleString()}`} />
        <Stat
          label="Projected monthly recovered spend"
          value={`$${Math.round(projections.monthlyRecovered).toLocaleString()}`}
        />
        <Stat
          label="Projected annual"
          value={`$${Math.round(projections.annualRecovered).toLocaleString()}`}
        />
        <Stat
          label="Payback period"
          value={
            projections.paybackMonths !== null && Number.isFinite(projections.paybackMonths)
              ? `${projections.paybackMonths.toFixed(1)} months`
              : "—"
          }
        />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
