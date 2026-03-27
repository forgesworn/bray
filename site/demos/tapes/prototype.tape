Set Shell "zsh"
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms
Set CursorBlink false

Output prototype.gif

# Custom prompt
Hide
Type "export PS1='darren@ForgeSworn.dev:bray $ '"
Enter
Sleep 0.5s
Type "clear"
Enter
Sleep 0.5s
Show

# User types the prompt
Type "claude 'Use the whoami tool to check which identity is active'"
Sleep 1s
Enter
Sleep 1s

# Claude's response
Type "echo ''"
Enter
Hide
Sleep 0.3s
Show

Type "echo '  ╭──────────────────────────────────────────────╮'"
Enter
Hide
Sleep 0.1s
Show

Type "echo '  │  Tool: whoami                                │'"
Enter
Hide
Sleep 0.1s
Show

Type "echo '  ╰──────────────────────────────────────────────╯'"
Enter
Hide
Sleep 0.1s
Show

Sleep 0.5s

Type "echo '  npub1qkl5g0yrj7nh0y4hgzpehmu9sjsmr68sgwvfkzml4jv7fhscqaxs9l8emm'"
Enter
Hide
Sleep 0.1s
Show

Sleep 0.5s

Type "echo ''"
Enter
Hide
Sleep 0.1s
Show

Type "echo '  Your active identity is npub1qkl...cqaxs9l8emm'"
Enter
Hide
Sleep 0.1s
Show

Type "echo '  (master key, no persona active)'"
Enter
Hide
Sleep 0.1s
Show

Sleep 3s
