/**
 * Connection validation rules for workflow nodes
 *
 * Valid connections:
 * - domain (output) → dockerApp (input): Domain routes to app
 * - dockerApp (database) → database (input): App connects to database
 * - dockerApp (output) → dockerApp (input): App-to-app connection
 * - service (output) → dockerApp (input): Service connects to app
 * - service (output) → database (input): Service connects to database
 */

// Connection rules matrix: [sourceType][sourceHandle] → [targetType][targetHandle]
const connectionRules = {
    domain: {
        output: {
            dockerApp: ['input'],
            service: ['input']
        }
    },
    dockerApp: {
        output: {
            dockerApp: ['input'],
            service: ['input']
        },
        database: {
            database: ['input']
        }
    },
    service: {
        output: {
            dockerApp: ['input'],
            database: ['input'],
            service: ['input']
        }
    },
    database: {
        // Database has no source handles, cannot connect to anything
    }
};

// Labels for connection types
export const connectionLabels = {
    'domain-dockerApp': 'Routes to',
    'domain-service': 'Routes to',
    'dockerApp-dockerApp': 'Connects to',
    'dockerApp-database': 'Uses DB',
    'service-dockerApp': 'Provides',
    'service-database': 'Uses',
    'service-service': 'Connects to'
};

// Colors for connection types
export const connectionColors = {
    'domain-dockerApp': '#10b981',
    'domain-service': '#10b981',
    'dockerApp-dockerApp': '#2496ed',
    'dockerApp-database': '#f59e0b',
    'service-dockerApp': '#6366f1',
    'service-database': '#f59e0b',
    'service-service': '#6366f1'
};

/**
 * Find a node by ID from the nodes array
 */
const findNode = (nodeId, nodes) => {
    return nodes.find(n => n.id === nodeId);
};

/**
 * Check if a connection is valid based on node types and handles
 * @param {Object} connection - { source, target, sourceHandle, targetHandle }
 * @param {Array} nodes - Array of nodes
 * @returns {boolean}
 */
export const isValidConnection = (connection, nodes) => {
    const { source, target, sourceHandle, targetHandle } = connection;

    // Prevent self-connections
    if (source === target) {
        return false;
    }

    const sourceNode = findNode(source, nodes);
    const targetNode = findNode(target, nodes);

    if (!sourceNode || !targetNode) {
        return false;
    }

    const sourceType = sourceNode.type;
    const targetType = targetNode.type;

    // Check if source type exists in rules
    if (!connectionRules[sourceType]) {
        return false;
    }

    // Check if source handle exists in rules
    const sourceHandleRules = connectionRules[sourceType][sourceHandle];
    if (!sourceHandleRules) {
        return false;
    }

    // Check if target type is allowed from this source handle
    const allowedTargetHandles = sourceHandleRules[targetType];
    if (!allowedTargetHandles) {
        return false;
    }

    // Check if target handle is in allowed list
    return allowedTargetHandles.includes(targetHandle);
};

/**
 * Get an error message for an invalid connection
 * @param {Object} connection - { source, target, sourceHandle, targetHandle }
 * @param {Array} nodes - Array of nodes
 * @returns {string|null} - Error message or null if valid
 */
export const getConnectionError = (connection, nodes) => {
    const { source, target, sourceHandle, targetHandle } = connection;

    if (source === target) {
        return 'Cannot connect a node to itself';
    }

    const sourceNode = findNode(source, nodes);
    const targetNode = findNode(target, nodes);

    if (!sourceNode || !targetNode) {
        return 'Invalid node reference';
    }

    const sourceType = sourceNode.type;
    const targetType = targetNode.type;

    // Check if source type can make outgoing connections
    if (!connectionRules[sourceType] || Object.keys(connectionRules[sourceType]).length === 0) {
        return `${formatNodeType(sourceType)} cannot create outgoing connections`;
    }

    // Check if source handle exists
    if (!connectionRules[sourceType][sourceHandle]) {
        return `Invalid source handle "${sourceHandle}"`;
    }

    // Check if target type is valid for this source
    const sourceHandleRules = connectionRules[sourceType][sourceHandle];
    if (!sourceHandleRules[targetType]) {
        return `Cannot connect ${formatNodeType(sourceType)} to ${formatNodeType(targetType)}`;
    }

    // Check target handle
    const allowedTargetHandles = sourceHandleRules[targetType];
    if (!allowedTargetHandles.includes(targetHandle)) {
        return `Invalid connection point on ${formatNodeType(targetType)}`;
    }

    return null;
};

/**
 * Get the connection type key for labels/colors
 * @param {string} sourceType - Source node type
 * @param {string} targetType - Target node type
 * @returns {string}
 */
export const getConnectionType = (sourceType, targetType) => {
    return `${sourceType}-${targetType}`;
};

/**
 * Format node type for display
 */
const formatNodeType = (type) => {
    const labels = {
        dockerApp: 'Docker App',
        database: 'Database',
        domain: 'Domain',
        service: 'Service'
    };
    return labels[type] || type;
};

export default {
    isValidConnection,
    getConnectionError,
    getConnectionType,
    connectionLabels,
    connectionColors
};
