import { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { apiBase, setApiBase, clearApiBase } from '../lib/index';

interface Props {
  disabled?: boolean;
}

export const BackendConfig: FunctionalComponent<Props> = ({ disabled }) => {
  const [currentBase, setCurrentBase] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setCurrentBase(apiBase());
    setInputValue(apiBase());
  }, []);

  const handleSave = () => {
    setApiBase(inputValue.trim());
    setCurrentBase(apiBase());
    setEditing(false);
  };

  const handleClear = () => {
    clearApiBase();
    setCurrentBase('');
    setInputValue('');
    setEditing(false);
  };

  const handleCancel = () => {
    setInputValue(currentBase);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div class="backend-config">
        <span class="backend-config__label">Backend:</span>
        <span class="backend-config__value">
          {currentBase || '(same origin)'}
        </span>
        <button
          class="fui-Button fui-Button--subtle fui-Button--small"
          onClick={() => setEditing(true)}
          disabled={disabled}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div class="backend-config">
      <span class="backend-config__label">Backend:</span>
      <div class={`fui-Input${disabled ? ' fui-Input--disabled' : ''}`} style={{ width: '200px' }}>
        <input
          class="fui-Input__input"
          type="text"
          placeholder="http://192.168.1.100:8080"
          value={inputValue}
          onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
          disabled={disabled}
          style={{ fontFamily: 'var(--fontFamilyMonospace)', fontSize: 'var(--fontSizeBase200)' }}
        />
      </div>
      <button class="fui-Button fui-Button--primary fui-Button--small" onClick={handleSave} disabled={disabled}>
        Save
      </button>
      <button class="fui-Button fui-Button--subtle fui-Button--small" onClick={handleClear} disabled={disabled}>
        Reset
      </button>
      <button class="fui-Button fui-Button--small" onClick={handleCancel} disabled={disabled}>
        Cancel
      </button>
    </div>
  );
};
