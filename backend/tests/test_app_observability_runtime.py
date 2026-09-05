"""Runtime-aware application logs keep single-container and compose support."""
from unittest.mock import patch

import pytest

from factories import headers_for, make_application, make_user


@pytest.fixture
def owner(app, db_session):
    return make_user(db_session, role='admin', username='observability-owner')


def test_logs_prefer_a_live_recorded_container(client, db_session, owner, tmp_path):
    """A repository compose file does not override the deployed runtime."""
    (tmp_path / 'docker-compose.yaml').write_text(
        'services:\n  db:\n    image: postgres\n', encoding='utf-8')
    application = make_application(
        db_session,
        name='standalone-api',
        root_path=str(tmp_path),
        compose_file=None,
        container_id='runtime-container-id',
        user_id=owner.id,
    )

    with patch('app.api.apps.DockerService.get_container',
               return_value={'Id': 'runtime-container-id'}), \
            patch('app.api.apps.DockerService.get_container_logs',
                  return_value={'success': True, 'logs': 'ready'}) as direct, \
            patch('app.api.apps.LogService.get_docker_app_logs') as compose:
        response = client.get(
            f'/api/v1/apps/{application.id}/logs?lines=250',
            headers=headers_for(owner),
        )

    assert response.status_code == 200
    assert response.get_json()['logs'] == 'ready'
    direct.assert_called_once_with(
        'runtime-container-id', tail=250, timestamps=False)
    compose.assert_not_called()


def test_logs_fall_back_to_compose_for_legacy_records(
        client, db_session, owner, tmp_path):
    application = make_application(
        db_session,
        name='legacy-compose',
        root_path=str(tmp_path),
        compose_file='compose.yaml',
        container_id=None,
        user_id=owner.id,
    )

    with patch('app.api.apps.LogService.get_docker_app_logs',
               return_value={'success': True, 'logs': 'compose-ready'}) as compose:
        response = client.get(
            f'/api/v1/apps/{application.id}/logs?lines=75',
            headers=headers_for(owner),
        )

    assert response.status_code == 200
    assert response.get_json()['logs'] == 'compose-ready'
    compose.assert_called_once_with(
        'legacy-compose', str(tmp_path), 75, compose_file='compose.yaml')


def test_a_stale_recorded_container_keeps_the_compose_fallback(
        client, db_session, owner, tmp_path):
    application = make_application(
        db_session,
        name='recreated-compose',
        root_path=str(tmp_path),
        compose_file='compose.yaml',
        container_id='removed-container-id',
        user_id=owner.id,
    )

    with patch('app.api.apps.DockerService.get_container', return_value=None), \
            patch('app.api.apps.DockerService.get_container_logs') as direct, \
            patch('app.api.apps.LogService.get_docker_app_logs',
                  return_value={'success': True, 'logs': 'fallback-ready'}) as compose:
        response = client.get(
            f'/api/v1/apps/{application.id}/logs',
            headers=headers_for(owner),
        )

    assert response.status_code == 200
    assert response.get_json()['logs'] == 'fallback-ready'
    direct.assert_not_called()
    compose.assert_called_once()
