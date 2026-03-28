Set Shell "zsh"
Set Width 1200
Set Height 500
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output gifs/canary-group-join.gif

Hide
Type "export PS1='user@bray:bray $ '"
Enter
Type "alias claude=./site/demos/bray-demo.sh"
Enter
Type "clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Use canary-group-create to create a group called demo-team, then use canary-group-join to join it'"
Enter
Sleep 25s
