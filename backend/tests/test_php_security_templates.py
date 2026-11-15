from pathlib import Path

import pytest
import yaml

from app.services.template_service import TemplateService


@pytest.mark.parametrize('name', ['wordpress', 'wordpress-external-db'])
def test_wordpress_build_files_do_not_become_container_mounts(tmp_path, name):
    template = yaml.safe_load((Path(__file__).parents[1] / 'templates' / f'{name}.yaml').read_text())
    variables = {'APP_NAME': 'test-wp', 'VERSION': '7.1.3-php8.3-apache'}
    compose = tmp_path / 'docker-compose.yml'
    compose.write_text(TemplateService.generate_compose(template, variables))
    result = TemplateService._process_template_files(template['files'], str(tmp_path), str(compose), variables)
    assert result['success']
    config = yaml.safe_load(compose.read_text())
    assert config['services']['wordpress']['volumes'] == ['wordpress_html:/var/www/html']
    assert result['bind_mounts'] == 0
    dockerfile = (tmp_path / 'Dockerfile.serverkit-php').read_text()
    assert 'FROM wordpress:7.1.3-php8.3-apache' in dockerfile
    assert '8.3.36' in dockerfile and 'pdo_mysql' in dockerfile
    assert 'php_admin_flag session.upload_progress.enabled Off' in dockerfile
    # Issue #252: Object Cache Pro refuses to start without PhpRedis, and the
    # upstream image does not ship it. Verified in the build, like pdo_mysql.
    assert 'pecl install redis' in dockerfile and 'docker-php-ext-enable redis' in dockerfile
    assert 'extension_loaded("redis")' in dockerfile
    # A collapsed line continuation would still be one valid-looking string.
    assert all(line.endswith('\\') or line.startswith((' && php', ' && docker-php-ext-install',
                                                      ' && a2enconf'))
               for line in dockerfile.splitlines() if line.startswith(('RUN', ' &&')))


def test_new_wordpress_sites_get_the_mysql_wordpress_recommends():
    # Issue #253: Site Health flags MySQL 8.0 as outdated; WordPress asks for 8.4+.
    template = yaml.safe_load((Path(__file__).parents[1] / 'templates' / 'wordpress.yaml').read_text())
    assert template['compose']['services']['db']['image'] == 'mysql:8.4'
