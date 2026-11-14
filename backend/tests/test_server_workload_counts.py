"""The server list reports how many services and domains each server carries."""
from app import db
from app.models.domain import Domain

from tests.factories import headers_for, make_application, make_server, make_user


def _rows(client, headers, query=''):
    resp = client.get(f'/api/v1/servers{query}', headers=headers)
    assert resp.status_code == 200
    return {row['name']: row for row in resp.get_json()}


def test_list_counts_services_and_domains_per_server(app, client):
    with app.app_context():
        admin = make_user(db, role='admin')
        busy = make_server(db, name='busy')
        make_server(db, name='idle')
        web = make_application(db, name='web', user_id=admin.id, server_id=busy.id)
        make_application(db, name='api', user_id=admin.id, server_id=busy.id)
        # Runs on the panel host: belongs to no server row.
        make_application(db, name='local', user_id=admin.id, server_id=None)
        db.session.add_all([
            Domain(name='a.example.test', application_id=web.id),
            Domain(name='b.example.test', application_id=web.id),
        ])
        db.session.commit()
        headers = headers_for(admin)

    rows = _rows(client, headers)
    assert (rows['busy']['services_count'], rows['busy']['domains_count']) == (2, 2)
    assert (rows['idle']['services_count'], rows['idle']['domains_count']) == (0, 0)


def test_deleted_services_and_domains_are_not_counted(app, client):
    with app.app_context():
        admin = make_user(db, role='admin')
        box = make_server(db, name='box')
        kept = make_application(db, name='kept', user_id=admin.id, server_id=box.id)
        gone = make_application(db, name='gone', user_id=admin.id, server_id=box.id)
        live = Domain(name='live.example.test', application_id=kept.id)
        dead = Domain(name='dead.example.test', application_id=kept.id)
        db.session.add_all([live, dead])
        db.session.commit()
        gone.soft_delete()
        dead.soft_delete()
        db.session.commit()
        headers = headers_for(admin)

    row = _rows(client, headers)['box']
    assert (row['services_count'], row['domains_count']) == (1, 1)


def test_counts_only_include_services_the_caller_can_see(app):
    """Asked at the service: a non-admin's count covers their own services
    only, while an admin's covers everything on the server."""
    from app.services.server_workload_service import workload_counts_by_server

    with app.app_context():
        admin = make_user(db, role='admin')
        owner = make_user(db, role='developer')
        other = make_user(db, role='developer')
        box = make_server(db, name='shared')
        mine = make_application(db, name='mine', user_id=owner.id, server_id=box.id)
        theirs = make_application(db, name='theirs', user_id=other.id, server_id=box.id)
        db.session.add_all([
            Domain(name='mine.example.test', application_id=mine.id),
            Domain(name='theirs.example.test', application_id=theirs.id),
        ])
        db.session.commit()

        assert workload_counts_by_server([box.id], owner)[box.id] == {
            'services_count': 1, 'domains_count': 1}
        assert workload_counts_by_server([box.id], admin)[box.id] == {
            'services_count': 2, 'domains_count': 2}
        assert workload_counts_by_server([box.id], None) == {}
        assert workload_counts_by_server([], admin) == {}


def test_select_can_ask_for_just_the_counts(app, client):
    with app.app_context():
        admin = make_user(db, role='admin')
        box = make_server(db, name='box')
        make_application(db, name='web', user_id=admin.id, server_id=box.id)
        headers = headers_for(admin)

    resp = client.get('/api/v1/servers?$select=name,services_count', headers=headers)
    assert resp.status_code == 200
    row = resp.get_json()[0]
    assert row['services_count'] == 1
    assert 'domains_count' not in row


def test_narrow_select_skips_the_counts(app, client):
    with app.app_context():
        admin = make_user(db, role='admin')
        make_server(db, name='box')
        headers = headers_for(admin)

    row = client.get('/api/v1/servers?$select=name', headers=headers).get_json()[0]
    assert 'services_count' not in row and 'domains_count' not in row
