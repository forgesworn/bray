Set Shell "zsh"
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output gifs/marketplace-compare.gif

Hide
Type "export PS1='user@bray:bray $ '"
Enter
Type "alias claude=./site/demos/bray-demo.sh"
Enter
Type "clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Use marketplace-announce to create two services: first with identifier demo-basic-translate, name Basic Translate, url https://api.example.com/basic, about Basic translation, pricing capability translate at 5 sats currency SAT, payment method l402. Second with identifier demo-pro-translate, name Pro Translate, url https://api.example.com/pro, about Premium translation, pricing capability translate at 15 sats currency SAT, payment method l402. Then use marketplace-compare to compare them side by side.'"
Enter
Sleep 30s
