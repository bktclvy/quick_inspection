const STEPS = [
  { label: 'ROI設定' },
  { label: 'テンプレート' },
  { label: 'データ収集' },
  { label: '学習' },
  { label: 'モデル割当' },
]

interface StepperProps {
  current: number
  onChange: (step: number) => void
}

export function Stepper({ current, onChange }: StepperProps) {
  return (
    <div className="stepper">
      {STEPS.map((step, i) => (
        <button
          key={i}
          className="stepper-step"
          data-active={i === current}
          onClick={() => onChange(i)}
        >
          <span className="stepper-num">{i + 1}</span>
          {step.label}
        </button>
      ))}
    </div>
  )
}
