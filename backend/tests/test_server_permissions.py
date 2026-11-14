from app.models.server import Server


def test_read_profiles_cover_agent_read_actions():
    server = Server(
        name='test-server',
        permissions=[
            'docker:container:read',
            'docker:image:read',
            'docker:volume:read',
            'docker:network:read',
            'docker:compose:read',
            'system:metrics:read',
        ],
    )

    assert server.has_permission('docker:container:list')
    assert server.has_permission('docker:container:inspect')
    assert server.has_permission('docker:container:logs')
    assert server.has_permission('docker:image:list')
    assert server.has_permission('docker:volume:list')
    assert server.has_permission('docker:network:list')
    assert server.has_permission('docker:compose:ps')
    assert server.has_permission('system:metrics')
    assert server.has_permission('system:info')
    assert not server.has_permission('docker:container:start')
    assert not server.has_permission('docker:image:pull')


def test_legacy_ui_permissions_still_work_for_existing_servers():
    server = Server(
        name='test-server',
        permissions=['docker:read', 'docker:write', 'system:read'],
    )

    assert server.has_permission('docker:container:list')
    assert server.has_permission('docker:container:start')
    assert server.has_permission('docker:image:pull')
    assert server.has_permission('system:metrics')
    assert server.has_permission('system:info')


def test_wildcard_permissions_still_match_agent_actions():
    server = Server(name='test-server', permissions=['docker:container:*'])

    assert server.has_permission('docker:container:list')
    assert server.has_permission('docker:container:restart')
    assert not server.has_permission('docker:image:list')


def test_probe_classifies_as_read():
    """doctor:probe is a read (plan 28 #7): it expands to doctor:read, not
    doctor:write, and is_read_action treats it as Observed-safe."""
    assert 'probe' in Server.READ_ACTION_VERBS
    assert Server.is_read_action('doctor:probe') is True
    # cron:update / systemd:restart stay mutating.
    assert Server.is_read_action('cron:update') is False
    assert Server.is_read_action('systemd:restart') is False


def test_scoped_profiles_grant_fleet_doctor_scopes():
    """Each scoped canned profile must let the fleet doctor pass has_permission
    on BOTH negotiation paths: doctor:probe (v2) and systemd:status (v1
    composed). systemd:restart / cron:update stay OUT of the read profiles
    (explicit grant or * only) per Decision 5."""
    from app.api.servers import PERMISSION_PROFILES

    for key in ('docker_readonly', 'docker_manager', 'deployment_runner'):
        perms = PERMISSION_PROFILES[key]['permissions']
        server = Server(name=f'srv-{key}', permissions=list(perms))
        assert server.has_permission('doctor:probe'), key
        assert server.has_permission('systemd:status'), key
        assert server.has_permission('survey:read'), key
        # Mutating v2 verbs must NOT be implied by the read profile.
        assert not server.has_permission('systemd:restart'), key
        assert not server.has_permission('cron:update'), key

    # full_access ('*') covers everything, including the mutating verbs.
    full = Server(name='full', permissions=list(PERMISSION_PROFILES['full_access']['permissions']))
    assert full.has_permission('doctor:probe')
    assert full.has_permission('systemd:restart')
    assert full.has_permission('cron:update')


def test_ssh_access_profile_allows_only_ssh_keys():
    """ssh_access lets an extension manage authorized_keys (ssh:keys:add /
    remove / list) and nothing mutating beyond that."""
    from app.api.servers import PERMISSION_PROFILES

    server = Server(name='ssh', permissions=list(PERMISSION_PROFILES['ssh_access']['permissions']))
    for action in ('ssh:keys:add', 'ssh:keys:remove', 'ssh:keys:list'):
        assert server.has_permission(action), action
    assert server.has_permission('doctor:probe')
    for action in ('system:exec', 'file:write', 'docker:container:create', 'systemd:restart'):
        assert not server.has_permission(action), action
