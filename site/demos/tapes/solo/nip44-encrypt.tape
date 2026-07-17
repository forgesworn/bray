Set Shell "bash"
Set Width 1200
Set Height 400
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output site/demos/gifs/nip44-encrypt.gif

Hide
Type "exec bash --noprofile --norc"
Enter
Type "export PS1='user@bray:bray $ '; alias claude=./site/demos/bray-demo.sh; clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Encrypt the message hello world using NIP-44 for recipient pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'"
Enter
Wait+Screen@420s /(?m)^user@bray:bray \$\s*$/
Sleep 3s
