Set Shell "bash"
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output site/demos/gifs/15-relay-discovery.gif

Hide
Type "exec bash --noprofile --norc"
Enter
Type "export PS1='user@bray:bray $ '; alias claude=./site/demos/bray-demo.sh; clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Discover relays used by contacts, search for relays supporting NIP-50 search, then get a relay recommendation'"
Enter
Wait+Screen@180s /(?m)^user@bray:bray \$\s*$/
Sleep 3s
