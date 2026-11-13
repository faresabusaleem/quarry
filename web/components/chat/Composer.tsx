"use client";

import { ArrowUp, Database, Lock, Square } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export interface ComposerHandle {
  focus: () => void;
}

export const Composer = forwardRef<
  ComposerHandle,
  {
    busy: boolean;
    placeholder: string;
    remaining: number | null;
    onSubmit: (text: string) => void;
    onStop: () => void;
    autoFocus?: boolean;
    initialText?: string;
  }
>(function Composer({ busy, placeholder, remaining, onSubmit, onStop, autoFocus, initialText = "" }, ref) {
  const [text, setText] = useState(initialText);
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }));

  const send = () => {
    if (!text.trim() || busy) return;
    onSubmit(text);
    setText("");
    if (area.current) area.current.style.height = "auto";
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor="question" className="visually-hidden">
        Your question about the data
      </label>
      <textarea
        id="question"
        ref={area}
        rows={1}
        value={text}
        maxLength={1000}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="composer-bar">
        <div className="composer-chips">
          <span className="chip" title="Brazilian E-Commerce Public Dataset by Olist, 9 tables">
            <Database aria-hidden /> Olist marketplace
          </span>
          <span className="chip" title="The database is opened read-only by the engine">
            <Lock aria-hidden /> Read-only
          </span>
        </div>
        <div className="composer-send">
          {remaining !== null && (
            <span className="composer-quota" aria-live="polite">
              {remaining} {remaining === 1 ? "question" : "questions"} left this hour
            </span>
          )}
          {busy ? (
            <button type="button" className="send-btn stop" onClick={onStop} aria-label="Stop the run">
              <Square aria-hidden />
            </button>
          ) : (
            <button type="submit" className="send-btn" disabled={!text.trim()} aria-label="Ask">
              <ArrowUp aria-hidden />
            </button>
          )}
        </div>
      </div>
    </form>
  );
});
