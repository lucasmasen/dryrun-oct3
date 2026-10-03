'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { TaskView, SubmitResponseInput } from '@/lib/delegate/types';
import { DemoRequestError, DemoStorageError, type DemoResponseType } from '@/lib/frontend/delegate/demo';
import { TaskRequestError, type SubmitReceipt } from '@/lib/frontend/delegate/model';
import styles from '@/app/(delegate)/delegate.module.css';
import { ResponseInput } from './response-input';
import { SilverFrame } from './effects';

type ResponseFormProps = {
  task: TaskView;
  receipt: SubmitReceipt | null;
  submit: (input: SubmitResponseInput) => Promise<SubmitReceipt>;
  refresh: () => Promise<void>;
  demoResponseType?: DemoResponseType;
  onReplay?: () => void;
};

type SubmissionError = { message: string; role: 'alert' | 'status' };

export function ResponseForm({
  task,
  receipt: savedReceipt,
  submit,
  refresh,
  demoResponseType,
  onReplay,
}: ResponseFormProps) {
  const [answer, setAnswer] = useState('');
  const [submittedReceipt, setSubmittedReceipt] = useState<SubmitReceipt | null>(null);
  const [submissionError, setSubmissionError] = useState<SubmissionError | null>(null);
  const [demoStorageFailure, setDemoStorageFailure] = useState(false);
  const [sending, setSending] = useState(false);
  const [conflictClosed, setConflictClosed] = useState(false);
  const [missing, setMissing] = useState(false);
  const duplicateGuard = useRef(false);
  const focusReceipt = useRef(false);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const receipt = submittedReceipt?.accepted
    ? submittedReceipt
    : savedReceipt?.accepted
      ? savedReceipt
      : null;

  useEffect(() => {
    if (!receipt || !focusReceipt.current) return;
    receiptHeading.current?.focus();
    focusReceipt.current = false;
  }, [receipt]);

  function changeAnswer(value: string) {
    setAnswer(value);
    setSubmissionError(null);
    setDemoStorageFailure(false);
  }
  const closed = task.status !== 'open' || conflictClosed;
  const taskClosing = task.status === 'closing' && !conflictClosed;
  const textLength = answer.trim().length;
  const validAnswer = task.response_type === 'choice'
    ? Boolean(task.options?.includes(answer))
    : task.response_type === 'text' && textLength >= 3 && textLength <= 1000;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAnswer || closed || sending || duplicateGuard.current) return;

    duplicateGuard.current = true;
    setSending(true);
    setSubmissionError(null);
    setDemoStorageFailure(false);
    const submittedAnswer = task.response_type === 'choice' ? answer : answer.trim();

    try {
      const result = await submit({ answer: submittedAnswer });
      if (result.accepted) {
        focusReceipt.current = true;
        setSubmittedReceipt(result);
      } else {
        setSubmissionError({
          message: result.reason || 'Your response was not accepted.',
          role: 'alert',
        });
      }
    } catch (cause) {
      const requestError = cause instanceof TaskRequestError || cause instanceof DemoRequestError
        ? cause
        : null;
      const status = requestError?.status ?? null;

      if (demoResponseType && cause instanceof DemoStorageError) {
        setDemoStorageFailure(true);
        setSubmissionError({ message: cause.message, role: 'alert' });
      } else if (status === 409) {
        setConflictClosed(true);
        setSubmissionError(null);
        try {
          await refresh();
        } catch {
          // Keep the 409 closure state even if the follow-up read is unavailable.
        }
      } else if (status === 404) {
        setMissing(true);
      } else if (!requestError || status === null || status >= 500) {
        setSubmissionError({
          message: 'Delivery unconfirmed. Your answer is still here. Resending may create a duplicate.',
          role: 'alert',
        });
      } else {
        setSubmissionError({ message: requestError.message, role: 'alert' });
      }
    } finally {
      duplicateGuard.current = false;
      setSending(false);
    }
  }

  if (receipt) {
    return (
      <section className={styles.receipt} role="status" aria-live="polite" aria-atomic="true">
        <h2 className={styles.receiptTitle} ref={receiptHeading} tabIndex={-1}>
          Response received
        </h2>
        <p className={styles.receiptCopy}>You’re done.</p>
      </section>
    );
  }

  if (missing) {
    return (
      <section className={styles.state} role="alert" aria-live="assertive">
        <span className={styles.stateMark} aria-hidden="true" />
        <h2 className={styles.stateTitle}>Task not found</h2>
        <p className={styles.stateMessage}>This task could not be found. Your response was not sent.</p>
      </section>
    );
  }

  if (closed && !sending && !submissionError) {
    return (
      <section className={styles.state} role="status" aria-live="polite">
        <span className={styles.stateMark} aria-hidden="true" />
        <h2 className={styles.stateTitle}>{taskClosing ? 'Task closing' : 'Task closed'}</h2>
        <p className={styles.stateMessage}>
          {taskClosing
            ? 'This task is no longer accepting new responses.'
            : 'This task is no longer accepting responses.'}
        </p>
      </section>
    );
  }

  if (task.response_type === 'photo') {
    return <p className={styles.feedback}>Photo responses aren’t supported in this demo.</p>;
  }

  if (task.response_type === 'choice' && !task.options?.length) {
    return <p className={styles.feedback} role="alert">No choices are available for this task.</p>;
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <ResponseInput task={task} value={answer} onChange={changeAnswer} disabled={sending || closed} />
      {submissionError ? (
        <p className={`${styles.feedback} ${styles.feedbackError}`} role={submissionError.role} aria-live="polite">
          {submissionError.message}
        </p>
      ) : sending ? (
        <p className={styles.feedback} role="status" aria-live="polite">Sending your response…</p>
      ) : closed ? (
        <p className={styles.feedback} role="status" aria-live="polite">This task is closing. Finishing your response…</p>
      ) : null}
      {submissionError && closed && !sending ? (
        <p className={styles.feedback} role="status" aria-live="polite">
          {taskClosing
            ? 'This task is closing and can’t accept another response.'
            : 'This task is closed and can’t accept another response.'}
        </p>
      ) : null}
      {demoStorageFailure && onReplay ? (
        <button className={styles.action} type="button" onClick={onReplay}>
          Replay demo
        </button>
      ) : null}
      <SilverFrame>
        <button className={styles.submit} type="submit" disabled={!validAnswer || sending || closed}>
          {sending ? 'Sending…' : demoStorageFailure ? 'Retry response' : 'Send response'}
        </button>
      </SilverFrame>
    </form>
  );
}
