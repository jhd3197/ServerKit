import { bindApiMethods } from './registry.js';
import ApiClient from './client.js';
import * as authMethods from './auth.js';
import * as appMethods from './apps.js';
import * as dockerMethods from './docker.js';
import * as databaseMethods from './databases.js';
import * as serverMethods from './servers.js';
import * as wordpressMethods from './wordpress.js';
import * as systemMethods from './system.js';
import * as securityMethods from './security.js';
import * as fileMethods from './files.js';
import * as dnsMethods from './dns.js';
import * as pluginMethods from './plugins.js';
import * as deploymentJobMethods from './deploymentJobs.js';
import * as pairingMethods from './pairing.js';
import * as sourceConnectionMethods from './sourceConnections.js';
import * as connectionMethods from './connections.js';
import * as aiMethods from './ai.js';
import * as tunnelMethods from './tunnels.js';
import * as secretsWebhooksMethods from './secretsWebhooks.js';
import * as containerOpsMethods from './containerOps.js';
import * as queueBusMethods from './queueBus.js';
import * as notificationMethods from './notifications.js';
import * as telemetryMethods from './telemetry.js';
import * as jobMethods from './jobs.js';
import * as backupProtectionMethods from './backupProtection.js';
import * as containerStatusMethods from './containerStatus.js';
import * as buildpackMethods from './buildpacks.js';
import * as snapshotMethods from './snapshots.js';
import * as projectMethods from './projects.js';
import * as sharedResourceMethods from './sharedResources.js';
import * as previewMethods from './previews.js';
import * as proxyMethods from './proxy.js';
import * as metadataGuardMethods from './metadataGuard.js';
import * as speedTestMethods from './speedtest.js';
import * as dbProcessMethods from './dbProcesses.js';
import * as dbTunerMethods from './dbTuner.js';
import * as importMethods from './imports.js';
import * as siteAdoptionMethods from './siteAdoption.js';
import * as doctorMethods from './doctor.js';
import * as bandwidthMethods from './bandwidth.js';
import * as htaccessToolMethods from './htaccessTools.js';
import * as manifestMethods from './manifests.js';
import * as surveyMethods from './survey.js';
import * as dnsCutoverMethods from './dnsCutover.js';
import * as searchMethods from './search.js';
import * as runMethods from './runs.js';
import * as testSandboxMethods from './testSandbox.js';
import * as themeMethods from './themes.js';
import * as dashboardMethods from './dashboards.js';
import * as monitorMethods from './monitors.js';
import * as viewMethods from './views.js';
import * as recycleBinMethods from './recycleBin.js';
import * as errorLogMethods from './errorLogs.js';
import * as walkthroughMethods from './walkthroughs.js';
import * as diskMethods from './disk.js';
import * as recipeMethods from './recipes.js';
import * as restorePointMethods from './restorePoints.js';

class ApiService extends ApiClient {
    constructor() {
        super();
        // Bind all methods from domain modules to this instance
        const modules = [
            authMethods,
            appMethods,
            dockerMethods,
            databaseMethods,
            serverMethods,
            wordpressMethods,
            systemMethods,
            securityMethods,
            fileMethods,
            dnsMethods,
            pluginMethods,
            deploymentJobMethods,
            pairingMethods,
            sourceConnectionMethods,
            connectionMethods,
            aiMethods,
            tunnelMethods,
            secretsWebhooksMethods,
            containerOpsMethods,
            queueBusMethods,
            notificationMethods,
            telemetryMethods,
            jobMethods,
            backupProtectionMethods,
            containerStatusMethods,
            buildpackMethods,
            snapshotMethods,
            projectMethods,
            sharedResourceMethods,
            previewMethods,
            proxyMethods,
            metadataGuardMethods,
            speedTestMethods,
            dbProcessMethods,
            dbTunerMethods,
            importMethods,
            siteAdoptionMethods,
            doctorMethods,
            bandwidthMethods,
            htaccessToolMethods,
            manifestMethods,
            surveyMethods,
            dnsCutoverMethods,
            searchMethods,
            runMethods,
            testSandboxMethods,
            themeMethods,
            dashboardMethods,
            monitorMethods,
            viewMethods,
            recycleBinMethods,
            errorLogMethods,
            walkthroughMethods,
            diskMethods,
            recipeMethods,
            restorePointMethods,
        ];
        bindApiMethods(this, modules);
    }
}

export const api = new ApiService();
export default api;
