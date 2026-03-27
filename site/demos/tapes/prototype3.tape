Set Shell "zsh"
Set Width 1200
Set Height 400
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output whoami7.gif

Hide
Type "export PS1='user@bray:bray $ '"
Enter
Sleep 0.3s
Type "clear"
Enter
Sleep 0.3s
Show

Type "claude -p 'Use the whoami tool' --bare --dangerously-skip-permissions --mcp-config ~/WebstormProjects/bray/site/demos/mcp-demo.json --system-prompt 'Be concise. No personal details.' --allowedTools 'mcp__nostr-bray__whoami'"
Enter
Sleep 15s
