Set Shell "zsh"
Set Width 1200
Set Height 500
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output gifs/vault-read.gif

Hide
Type "export PS1='user@bray:bray $ '"
Enter
Type "alias claude=./site/demos/bray-demo.sh"
Enter
Type "clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Use vault-create to create a vault, use vault-encrypt to store a secret message, then use vault-read to read it back'"
Enter
Sleep 25s
