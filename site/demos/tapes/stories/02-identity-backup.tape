Set Shell "zsh"
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output gifs/02-identity-backup.gif

Hide
Type "export PS1='user@bray:bray $ '"
Enter
Type "alias claude=./site/demos/bray-demo.sh"
Enter
Type "clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Back up the current identity using Shamir secret sharing with a 2-of-3 threshold, then restore it from 2 shares'"
Enter
Sleep 25s
