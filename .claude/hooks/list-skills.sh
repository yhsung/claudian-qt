#!/usr/bin/env bash
# Lists all available skills at session start

SKILLS_DIR="$HOME/.claude/skills"

if [ ! -d "$SKILLS_DIR" ]; then
  echo "No skills directory found at $SKILLS_DIR"
  exit 0
fi

echo "## Available Skills"
echo ""

find "$SKILLS_DIR" -maxdepth 2 -name "SKILL.md" \
  | sed "s|$SKILLS_DIR/||" \
  | sed 's|/SKILL.md||' \
  | grep -v "^gstack/" \
  | sort \
  | while read -r skill; do
      echo "- /$skill"
    done

echo ""
echo "_Invoke any skill with \`/skill-name\` in your message._"
