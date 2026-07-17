Set Shell "bash"
Set Width 1200
Set Height 400
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output site/demos/gifs/group-chat.gif

Hide
Type "exec bash --noprofile --norc"
Enter
Type "export PS1='user@bray:bray $ '; alias claude=./site/demos/bray-demo.sh; clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Use group-chat to view recent messages in a NIP-29 group on wss://groups.fiatjaf.com'"
Enter
Wait+Screen@420s /(?m)^user@bray:bray \$\s*$/
Sleep 3s
