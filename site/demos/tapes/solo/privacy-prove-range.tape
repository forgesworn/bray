Set Shell "bash"
Set Width 1200
Set Height 400
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output site/demos/gifs/privacy-prove-range.gif

Hide
Type "exec bash --noprofile --norc"
Enter
Type "export PS1='user@bray:bray $ '; alias claude=./site/demos/bray-demo.sh; clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Use the privacy-prove-range tool to create a range proof that the value 42 is between 0 and 100'"
Enter
Wait+Screen@180s /(?m)^user@bray:bray \$\s*$/
Sleep 3s
