import { M3eIconButton } from '@m3e/react/icon-button';
import { M3eIcon } from '@m3e/react/icon';

/**
 * 参数步进器：[−] 值 [+]，值可直接键入（触摸目标 ≥ 40px，移动端友好）。
 * 只管增减与键入，范围钳制交由调用方（各 dialog 的语义不同）。
 * 供表情切割 dialog 与头像合成 dialog 共用。
 */
export function ParamStepper({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="crop-param-row">
      <span className="crop-param-label">{label}</span>
      <div className="crop-stepper">
        <M3eIconButton size="small" aria-label={`${label}减 1`} onClick={() => onChange(value - 1)}>
          <M3eIcon name="remove" />
        </M3eIconButton>
        <input
          className="crop-stepper-input"
          type="number"
          inputMode="numeric"
          min={min}
          step={1}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <M3eIconButton size="small" aria-label={`${label}加 1`} onClick={() => onChange(value + 1)}>
          <M3eIcon name="add" />
        </M3eIconButton>
      </div>
    </div>
  );
}
