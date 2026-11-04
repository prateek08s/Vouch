"use client";

import { RuleForm } from "./RuleForm";

type TopicOptions = { group: string; options: { slug: string; name: string }[] }[];

export function RuleControls({ topicOptions, hasNoShorts }: { topicOptions: TopicOptions; hasNoShorts: boolean }) {
  return (
    <section aria-labelledby="add-h" className="rule-controls">
      <h2 id="add-h" className="eyebrow">Add a rule</h2>

      <div className="field">
        <label htmlFor="rule-topic">Hide a topic</label>
        <RuleForm kind="topic" label="Hide a topic">
          {(value, setValue) => (
            <select id="rule-topic" name="value" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose a topic…</option>
              {topicOptions.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
                </optgroup>
              ))}
            </select>
          )}
        </RuleForm>
        <p className="hint">Hiding a topic also hides its subtopics. Hiding Hardware hides GPU and CPU.</p>
      </div>

      <div className="field">
        <label htmlFor="rule-keyword">Hide titles containing a word</label>
        <RuleForm kind="keyword" label="Hide a keyword">
          {(value, setValue) => (
            <input id="rule-keyword" name="value" type="text" maxLength={50} placeholder="crypto" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </RuleForm>
        <p className="hint">Whole words only, so “ai” won’t hide “rain”.</p>
      </div>

      <div className="field">
        <label htmlFor="rule-min">Hide videos shorter than (minutes)</label>
        <RuleForm kind="min_duration" label="Minimum length" submitLabel="Set minimum">
          {(value, setValue) => (
            <input id="rule-min" name="value" type="number" min={1} max={600} step={1} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </RuleForm>
      </div>

      <div className="field">
        <label htmlFor="rule-max">Hide videos longer than (minutes)</label>
        <RuleForm kind="max_duration" label="Maximum length" submitLabel="Set maximum">
          {(value, setValue) => (
            <input id="rule-max" name="value" type="number" min={1} max={600} step={1} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </RuleForm>
        <p className="hint">With a length rule set, videos whose length we don’t know yet are hidden too.</p>
      </div>

      {!hasNoShorts && (
        <div className="field">
          <span className="label-like">Shorts</span>
          <RuleForm kind="no_shorts" label="Hide Shorts" submitLabel="Hide all Shorts" />
        </div>
      )}
    </section>
  );
}
