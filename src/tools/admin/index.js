import { CHANNEL_ADMIN_TOOLS } from './channels.js';
import { MEMBER_TOOLS } from './members.js';
import { READ_TOOLS } from './read.js';
import { ROLE_TOOLS } from './roles.js';
import { SCAFFOLD_TOOLS } from './scaffold.js';
import { MODERATION_TOOLS } from './moderation.js';

export const ADMIN_TOOLS = [...READ_TOOLS, ...MEMBER_TOOLS, ...CHANNEL_ADMIN_TOOLS, ...ROLE_TOOLS, ...SCAFFOLD_TOOLS, ...MODERATION_TOOLS];
