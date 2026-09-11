"""The wizard's default sidebar preference must survive onboarding."""


def test_recommended_sidebar_preset_is_saved_and_read_back(client, auth_headers):
    preference = {'preset': 'recommended', 'hiddenItems': []}
    response = client.put('/api/v1/auth/me', headers=auth_headers,
                          json={'sidebar_config': preference})
    assert response.status_code == 200
    assert response.json['user']['sidebar_config'] == preference
    assert client.get('/api/v1/auth/me', headers=auth_headers).json['user']['sidebar_config'] == preference


def test_invalid_sidebar_preset_does_not_overwrite_saved_preference(client, auth_headers):
    preference = {'preset': 'recommended', 'hiddenItems': []}
    client.put('/api/v1/auth/me', headers=auth_headers, json={'sidebar_config': preference})
    response = client.put('/api/v1/auth/me', headers=auth_headers,
                          json={'sidebar_config': {'preset': 'unknown', 'hiddenItems': []}})
    assert response.status_code == 400
    assert client.get('/api/v1/auth/me', headers=auth_headers).json['user']['sidebar_config'] == preference
