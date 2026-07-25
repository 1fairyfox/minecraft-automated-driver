// Shared between the protocol suite and the stdio e2e (a plain helper — NOT a test
// file: importing a test file re-registers its tests in the importer's process).
export const EXPECTED_TOOLS = [
  'agent_click', 'agent_close_screen', 'agent_connect', 'agent_disconnect', 'agent_events',
  'agent_exec', 'agent_key', 'agent_look', 'agent_move', 'agent_position', 'agent_screen',
  'agent_screenshot', 'agent_slots', 'agent_state', 'agent_type',
  'bot_chat', 'bot_equip', 'bot_inventory', 'bot_join', 'bot_messages', 'bot_move', 'bot_quit',
  'bot_status', 'bots_list',
  'build_gradle', 'client_kill', 'client_spawn', 'clients_list',
  'driver_status', 'goal_gather', 'goal_hunt', 'goal_navigate', 'instance_close', 'instance_open', 'instances_list',
  'job_kill', 'job_log', 'job_status', 'jobs_list',
  'os_screenshot', 'os_windows_list',
  'scenario_run',
  'server_exec', 'server_provision', 'server_start', 'server_stop', 'servers_list',
  'targets_list',
  'ui_menu_navigate', 'ui_server_connect', 'ui_settings_set', 'ui_slider',
  'ui_world_create', 'ui_world_enter', 'ui_world_leave',
];
