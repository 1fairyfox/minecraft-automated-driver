// Shared between the protocol suite and the stdio e2e (a plain helper — NOT a test
// file: importing a test file re-registers its tests in the importer's process).
export const EXPECTED_TOOLS = [
  'agent_click', 'agent_connect', 'agent_disconnect', 'agent_events', 'agent_exec',
  'agent_key', 'agent_screen', 'agent_state',
  'build_gradle', 'driver_status', 'instance_close', 'instance_open', 'instances_list',
  'job_kill', 'job_log', 'job_status', 'jobs_list',
  'os_screenshot', 'os_windows_list',
  'server_exec', 'server_provision', 'server_start', 'server_stop', 'servers_list',
];
