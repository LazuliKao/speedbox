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
          class="backend-config__edit"
          onClick={() => setEditing(true)}
          disabled={disabled}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div class="backend-config backend-config--editing">
      <span class="backend-config__label">Backend:</span>
      <input
        class="backend-config__input"
        type="text"
        placeholder="http://192.168.1.100:8080"
        value={inputValue}
        onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
        disabled={disabled}
      />
      <button class="backend-config__save" onClick={handleSave} disabled={disabled}>
        Save
      </button>
      <button class="backend-config__clear" onClick={handleClear} disabled={disabled}>
        Reset
      </button>
      <button class="backend-config__cancel" onClick={handleCancel} disabled={disabled}>
        Cancel
      </button>
    </div>
  );
};
