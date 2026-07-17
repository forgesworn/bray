Set Shell "bash"
Set Width 1200
Set Height 500
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output site/demos/gifs/marketplace-retire.gif

Hide
Type "exec bash --noprofile --norc"
Enter
Type "export PS1='user@bray:bray $ '; alias claude=./site/demos/bray-demo.sh; clear"
Enter
Sleep 0.5s
Show

Type "claude -p 'Use marketplace-announce to create a service with identifier demo-temp-svc, name Temp Service, url https://api.example.com, about Temporary test service, pricing capability test at 1 sat currency SAT, payment method l402. Then use marketplace-retire to retire identifier demo-temp-svc with reason demo cleanup'"
Enter
Wait+Screen@180s /(?m)^user@bray:bray \$\s*$/
Sleep 3s
