import { CHANNEL_ADMIN_TOOLS } from './channels.js';
import { MEMBER_TOOLS } from './members.js';
import { READ_TOOLS } from './read.js';
import { ROLE_TOOLS } from './roles.js';
import { SERVER_TOOLS } from '../server/tools.js';
import { MODERATION_TOOLS } from '../moderation/tools.js';
import { INTERVENTION_TOOLS } from '../conversation/tools.js';
import { PUBLICATION_TOOLS } from './publications.js';
import { ROLE_PANEL_TOOLS } from './role-panels.js';
import { SECURITY_TOOLS } from '../security/tools.js';
import { SETUP_TOOLS } from './setup.js';

export const ADMIN_TOOLS = [...READ_TOOLS, ...MEMBER_TOOLS, ...CHANNEL_ADMIN_TOOLS, ...ROLE_TOOLS, ...SERVER_TOOLS, ...MODERATION_TOOLS, ...INTERVENTION_TOOLS, ...PUBLICATION_TOOLS, ...ROLE_PANEL_TOOLS, ...SECURITY_TOOLS, ...SETUP_TOOLS];
