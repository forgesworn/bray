Set Shell "bash"
Set Width 1200
Set Height 500
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output site/demos/gifs/privacy-verify-threshold.gif

Hide
Type "exec bash --noprofile --norc"
Enter
Type "export PS1='user@bray:bray $ '; alias claude=./site/demos/bray-demo.sh; clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Create a commitment for value 500, prove it exceeds 100, then verify the proof'"
Enter
Wait+Screen@180s /(?m)^user@bray:bray \$\s*$/
Sleep 3s
