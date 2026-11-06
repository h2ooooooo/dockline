# CLI troubleshooting

| Symptom | What to check |
| --- | --- |
| Exit 2 with a configuration error | The file exists, is UTF-8 YAML, and uses the [documented schema](/cli/configuration). A missing-file [example](/cli/output#safe-configuration-error-example) shows the exact JSON. |
| Selected protocol client is missing | Install the matching client beside the CLI: globally for a global command, locally for a project command. |
| SFTP rejects an unknown or changed key | Verify the server fingerprint independently; configure its pin or review the managed record. JSON/noninteractive use cannot approve a new host. |
| Authentication fails | Supply supported credentials in configuration. The CLI does not prompt for a password. |
| Download refuses an existing file | Select a new local name or explicitly pass `--overwrite replace`. |
| FTP upload refuses `--overwrite fail` | Portable FTP cannot guarantee no-replace publication. Choose a supported policy/transport for the job. |
| A listing is incomplete | Review recursive depth/entry budgets; an incomplete inventory is an error. |
| Connection or permission failure | Confirm server host/port, remote root and account permissions. Inspect the JSON error code; do not assume retries make mutations safe. |

Start with the [local-server walkthrough](/cli/quick-start) to separate installation problems from your server configuration. See [all command inputs](/cli/help) and [output contracts](/cli/output) for precise flags and statuses.
