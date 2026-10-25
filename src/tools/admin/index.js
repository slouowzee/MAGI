import { CHANNEL_ADMIN_TOOLS } from './channels.js';
import { MEMBER_TOOLS } from './members.js';
import { READ_TOOLS } from './read.js';
import { ROLE_TOOLS } from './roles.js';

export const ADMIN_TOOLS = [...READ_TOOLS, ...MEMBER_TOOLS, ...CHANNEL_ADMIN_TOOLS, ...ROLE_TOOLS];
