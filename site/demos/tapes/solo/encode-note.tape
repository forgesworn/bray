Set Shell "bash"
Set Width 1200
Set Height 400
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output site/demos/gifs/encode-note.gif

Hide
Type "exec bash --noprofile --norc"
Enter
Type "export PS1='user@bray:bray $ '; alias claude=./site/demos/bray-demo.sh; clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Encode the hex event ID d4ea1b7ffb77c1fba9b84fda4e8d838db7a39c63a9bde3962a1cb13b2c4d50e3 as a note'"
Enter
Wait+Screen@180s /(?m)^user@bray:bray \$\s*$/
Sleep 3s
