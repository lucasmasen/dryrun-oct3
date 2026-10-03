import type { TaskView } from '@/lib/delegate/types';
import styles from '@/app/(delegate)/delegate.module.css';

type ResponseInputProps = {
  task: TaskView;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
};

function textValidityMessage(value: string) {
  const length = value.trim().length;
  if (length < 3) return 'Enter at least 3 characters after trimming.';
  if (length > 1000) return 'Keep your response to 1,000 characters after trimming.';
  return '';
}

export function ResponseInput({ task, value, onChange, disabled }: ResponseInputProps) {
  if (task.response_type === 'choice') {
    if (!task.options?.length) {
      return <p className={styles.feedback} role="alert">No choices are available for this task.</p>;
    }

    return (
      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend className={styles.legend}>Choose one response</legend>
        <div className={styles.options}>
          {task.options.map((option, index) => (
            <label className={styles.option} key={`${option}-${index}`}>
              <input
                className={styles.radio}
                type="radio"
                name={`response-${task.id}`}
                value={option}
                checked={value === option}
                required
                onChange={() => onChange(option)}
              />
              <span className={styles.optionText}>{option}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (task.response_type === 'photo') {
    return <p className={styles.feedback}>Photo responses aren’t supported in this demo.</p>;
  }

  return (
    <div>
      <label className={styles.legend} htmlFor="delegate-response">Your response</label>
      <textarea
        className={styles.textarea}
        id="delegate-response"
        name="answer"
        value={value}
        placeholder="Write your response…"
        required
        minLength={3}
        aria-describedby="delegate-response-help"
        disabled={disabled}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          event.currentTarget.setCustomValidity(textValidityMessage(nextValue));
          onChange(nextValue);
        }}
        onInvalid={(event) => {
          event.currentTarget.setCustomValidity(textValidityMessage(value));
        }}
      />
      <p className={styles.inputHelp} id="delegate-response-help">
        3–1,000 characters after trimming.
      </p>
    </div>
  );
}
