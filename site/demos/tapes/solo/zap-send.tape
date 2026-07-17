Set Shell "bash"
Set Width 1200
Set Height 500
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output site/demos/gifs/zap-send.gif

Hide
Type "exec bash --noprofile --norc"
Enter
Type "export PS1='user@bray:bray $ '; alias claude=./site/demos/bray-demo.sh; clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Switch to the demo persona, check the wallet balance, then create a lightning invoice for 21 sats'"
Enter
Wait+Screen@420s /(?m)^user@bray:bray \$\s*$/
Sleep 3s
