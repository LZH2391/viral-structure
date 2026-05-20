param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Suites
)

node "$PSScriptRoot\Tests\run-tests.js" @Suites
