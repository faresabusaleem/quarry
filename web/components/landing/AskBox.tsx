"use client";

// The closing fragment: the product's composer, already open, holding a real benchmark
// question you can edit. Asking opens the app with the question filled in.

import { ArrowUp, Database, Lock } from "lucide-react";
import { useState } from "react";

export function AskBox({ example }: { example: string }) {
  const [text, setText] = useState(example);
  const go = () => {
    const q = text.trim();
    window.location.href = q ? `/app/?q=${encodeURIComponent(q)}` : "/app/";
  };
  return (
    <form
      className="ask-box"
      data-ui
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label htmlFor="landing-question" className="ask-box-title">
        What do you want to know about your data?
      </label>
      <textarea id="landing-question" rows={3} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
      <div className="ask-box-bar">
        <span className="chip">
          <Database aria-hidden /> Olist marketplace
        </span>
        <span className="chip">
          <Lock aria-hidden /> Read-only
        </span>
        <button type="submit" className="btn btn-primary ask-box-go">
          Ask Quarry <ArrowUp aria-hidden />
        </button>
      </div>
    </form>
  );
}
