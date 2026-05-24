import unittest
from pathlib import Path

from agent_runtime.appserver.client import AppServerSessionClient


class AppServerShellCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = AppServerSessionClient(Path(__file__).resolve().parents[2], transport_mode="ws")

    def run_tool(self, command: str) -> dict:
        return self.client._run_shell_command(
            {
                "command": command,
                "workdir": str(Path(__file__).resolve().parents[2]),
                "timeout_ms": 30000,
            }
        )

    def test_prefers_native_exit_code_when_pipeline_sets_error_state(self) -> None:
        command = (
            "& { [Console]::Error.WriteLine('native stderr line'); exit 0 } "
            "2>&1 | Select-String -Pattern 'native stderr'"
        )
        result = self.run_tool(command)

        self.assertTrue(result["success"])
        self.assertIn("Exit code: 0", result["contentItems"][0]["text"])

    def test_preserves_native_nonzero_exit_code(self) -> None:
        result = self.run_tool("cmd /c exit 7")

        self.assertFalse(result["success"])
        self.assertIn("Exit code: 7", result["contentItems"][0]["text"])

    def test_preserves_powershell_cmdlet_failure(self) -> None:
        result = self.run_tool("Get-Content -LiteralPath 'C:\\path\\does-not-exist.txt'")

        self.assertFalse(result["success"])
        self.assertIn("Exit code: 1", result["contentItems"][0]["text"])


if __name__ == "__main__":
    unittest.main()
