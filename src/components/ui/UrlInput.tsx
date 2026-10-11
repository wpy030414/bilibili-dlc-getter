import { M3eButton } from '@m3e/react/button';
import { M3eFormField } from '@m3e/react/form-field';
import { M3eIcon } from '@m3e/react/icon';
import { M3eCircularProgressIndicator } from '@m3e/react/progress-indicator';
import { useState } from 'react';

const DEMO_URL =
  'https://www.bilibili.com/blackboard/activity-Mz9T5bO5Q3.html?type=dlc&id=104978&lottery_id=105056';

interface Props {
  onSubmit: (url: string) => void;
  disabled: boolean;
}

export function UrlInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    if (disabled) return;
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        marginBottom: 24,
        flexWrap: 'wrap',
      }}
    >
      {/* hideSubscript：隐藏辅助文本行（details），避免无 hint/error 时仍占位 */}
      <M3eFormField variant="filled" hideSubscript="always" style={{ flex: '1 1 300px' }}>
        <label slot="label" htmlFor="url-input">Bilibili 活动页面链接</label>
        {/* 单行输入：高度固定为一行，长链接横向滚动 */}
        <input
          id="url-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={DEMO_URL}
          style={{ width: '100%' }}
        />
      </M3eFormField>
      <M3eButton
        variant="filled"
        onClick={handleSubmit}
        disabled={disabled}
        style={{ flexShrink: 0, height: 'fit-content' }}
      >
        {disabled ? (
          <M3eCircularProgressIndicator
            indeterminate
            variant="flat"
            style={{
              '--m3e-circular-flat-progress-indicator-diameter': '20px',
            } as React.CSSProperties}
          />
        ) : (
          <>
            <M3eIcon slot="icon" name="search" />
            解析
          </>
        )}
      </M3eButton>
    </div>
  );
}
