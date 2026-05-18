Acceptance Auditor — Spec-Based Review Prompt

Role: Acceptance Auditor (requires spec + diff + context docs).

NOTE: This project run used `no-spec` mode. If you provide a spec file later, use this prompt.

Instructions:
- Review the diff against the provided spec and any context docs. Check for:
  - Violations of acceptance criteria
  - Missing implementation of specified behaviors
  - Deviations from the spec intent
  - Contradictions between constraints and code changes
- For each finding produce a Markdown list item with:
  - one-line title
  - which acceptance criterion / constraint it violates (quote the AC id/text)
  - evidence from diff and/or file contents (code lines)
  - recommended remediation

Input: Attach the spec file and the diff. If the spec frontmatter contains `context` entries, include those docs as well.

Output example:
- Title — AC: `AC-3: returns 200 for empty input` — Evidence — Recommended fix

Return findings only. If none, return "No findings."