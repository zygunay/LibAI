#!/usr/bin/env bash
set -euo pipefail

repo="${1:-zygunay/LibAI}"
tasks_file="${2:-docs/TASKS.md}"
gh_bin="${GH_BIN:-gh}"

if [[ ! -f "$tasks_file" ]]; then
  echo "Task file not found: $tasks_file" >&2
  exit 1
fi

declare -A phase_titles=(
  [A]="Foundation"
  [B]="Intent & Query Planning"
  [C]="npm Discovery"
  [D]="GitHub Discovery"
  [E]="Evidence & Normalization"
  [F]="Cache & Resilience"
  [G]="Deterministic Ranking"
  [H]="Evaluation & Quality"
  [I]="Local LLM & Prompt Safety"
  [J]="Recommendation API & Data"
  [K]="Web Product"
  [L]="Production & Public Beta"
  [M]="Dependency Advisor"
  [N]="Multi-Ecosystem Expansion"
)

declare -A milestones
while IFS=$'\t' read -r number title; do
  [[ -n "$number" ]] && milestones["$title"]="$number"
done < <("$gh_bin" api --paginate "repos/$repo/milestones?state=all&per_page=100" \
  --jq '.[] | [.number, .title] | @tsv')

"$gh_bin" label create roadmap --repo "$repo" --color 0E8A16 \
  --description "Tracked in the LibAI delivery roadmap" --force >/dev/null
"$gh_bin" label create task --repo "$repo" --color 1D76DB \
  --description "Numbered implementation task" --force >/dev/null
"$gh_bin" label create epic --repo "$repo" --color 5319E7 \
  --description "Roadmap phase epic" --force >/dev/null

for phase in {A..N}; do
  milestone_title="Phase $phase — ${phase_titles[$phase]}"
  "$gh_bin" label create "phase:$phase" --repo "$repo" --color D4C5F9 \
    --description "Roadmap phase $phase" --force >/dev/null

  if [[ -z "${milestones[$milestone_title]:-}" ]]; then
    milestone_number=$("$gh_bin" api --method POST "repos/$repo/milestones" \
      -f title="$milestone_title" \
      -f description="LibAI roadmap phase $phase: ${phase_titles[$phase]}" \
      --jq '.number')
    milestones["$milestone_title"]="$milestone_number"
  fi
done

declare -A existing_epics
while IFS= read -r title; do
  if [[ "$title" =~ ^\[PHASE-([A-N])\] ]]; then
    existing_epics["${BASH_REMATCH[1]}"]=1
  fi
done < <("$gh_bin" api --paginate "repos/$repo/issues?state=all&per_page=100" \
  --jq '.[].title')

for phase in {A..N}; do
  [[ -n "${existing_epics[$phase]:-}" ]] && continue
  milestone_title="Phase $phase — ${phase_titles[$phase]}"
  "$gh_bin" api --method POST "repos/$repo/issues" \
    -f title="[PHASE-$phase] ${phase_titles[$phase]}" \
    -f body="Roadmap phase $phase epic. Scope and exit gate: \`docs/ROADMAP.md\`. Numbered work items: \`docs/TASKS.md\`." \
    -F milestone="${milestones[$milestone_title]}" \
    -f labels[]=epic \
    -f labels[]=roadmap \
    -f labels[]="phase:$phase" \
    --jq '.html_url'
done

declare -A existing
while IFS= read -r title; do
  if [[ "$title" =~ ^\[([A-N]-[0-9]{3})\] ]]; then
    existing["${BASH_REMATCH[1]}"]=1
  fi
done < <("$gh_bin" api --paginate "repos/$repo/issues?state=all&per_page=100" \
  --jq '.[].title')

created=0
skipped=0

while IFS= read -r line; do
  if [[ ! "$line" =~ ^-\ \[[[:space:]x~!]\]\ \*\*([A-N]-[0-9]{3})\*\*\ (.*)\ —\ Doğrulama:\ (.*)\.$ ]]; then
    continue
  fi

  task_id="${BASH_REMATCH[1]}"
  task_title="${BASH_REMATCH[2]}"
  verification="${BASH_REMATCH[3]}"
  phase="${task_id:0:1}"

  if [[ -n "${existing[$task_id]:-}" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  milestone_title="Phase $phase — ${phase_titles[$phase]}"
  milestone_number="${milestones[$milestone_title]}"
  body=$(printf '%s\n' \
    "## Amaç" \
    "$task_title." \
    "" \
    "## Kabul kriterleri" \
    "- [ ] Tanımlanan çıktı tamamlandı" \
    "- [ ] İlgili test, fixture ve doküman aynı değişiklikte güncellendi" \
    "- [ ] Faz sınırları dışında yeni kapsam eklenmedi" \
    "" \
    "## Doğrulama" \
    "$verification." \
    "" \
    "## Kaynak" \
    "\`docs/TASKS.md\` ve \`docs/ROADMAP.md\`.")

  "$gh_bin" api --method POST "repos/$repo/issues" \
    -f title="[$task_id] $task_title" \
    -f body="$body" \
    -F milestone="$milestone_number" \
    -f labels[]=task \
    -f labels[]=roadmap \
    -f labels[]="phase:$phase" \
    --jq '.html_url'

  existing["$task_id"]=1
  created=$((created + 1))
  sleep 0.15
done < "$tasks_file"

echo "Roadmap sync complete: created=$created skipped=$skipped"
