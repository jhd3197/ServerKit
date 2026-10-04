import { useState } from 'react';
import { FileCode2, ArrowRight, AlertTriangle } from 'lucide-react';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/CopyButton';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Paste-in .htaccess -> nginx converter for the per-site custom nginx rules
// editor. Pairs with the site-import feature: imported cPanel sites carry
// .htaccess files whose rewrite/redirect/auth rules need nginx equivalents.
//
// Usage (next to the custom-rules textarea):
//   <HtaccessConverter onInsert={(nginx) => setRules(r => (r ? r + '\n' : '') + nginx)} />
//
// `onInsert(nginxText)` is optional; without it the modal still offers
// copy-to-clipboard. `trigger` overrides the default launcher button.
export default function HtaccessConverter({ onInsert, trigger = null }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [source, setSource] = useState('');
    const [converting, setConverting] = useState(false);
    const [result, setResult] = useState(null);

    const handleConvert = async () => {
        if (!source.trim() || converting) return;
        setConverting(true);
        try {
            const res = await api.convertHtaccess(source);
            setResult(res);
            if (!res.nginx && !(res.unsupported || []).length) {
                toast.info(t('app.htaccessConverter.nothingToConvertNoDirectivesFound', 'Nothing to convert. No directives found.'));
            }
        } catch (err) {
            toastError(toast, t('app.htaccessConverter.conversionFailed', "Couldn't convert the file."), err);
        } finally {
            setConverting(false);
        }
    };

    const handleInsert = () => {
        if (!result?.nginx) return;
        onInsert?.(result.nginx);
        toast.success(t('app.htaccessConverter.convertedRulesInsertedReviewBeforeSaving', 'Converted rules inserted. Review before saving.'));
        handleClose();
    };

    const handleClose = () => {
        setOpen(false);
        setResult(null);
        setSource('');
    };

    const unsupported = result?.unsupported || [];
    const notes = result?.notes || [];

    return (
        <>
            {trigger ? (
                <span onClick={() => setOpen(true)}>{trigger}</span>
            ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                    <FileCode2 size={16} />
                    {t('app.htaccessConverter.convertHtaccess', 'Convert .htaccess')}
                </Button>
            )}

            <Modal
                open={open}
                onClose={handleClose}
                title={t('app.htaccessConverter.convertHtaccessToNginx', 'Convert .htaccess to nginx')}
                size="lg"
                footer={(
                    <div className="htaccess-converter__footer">
                        <Button type="button" variant="ghost" onClick={handleClose}>
                            {t('common.actions.close', 'Close')}
                        </Button>
                        {result?.nginx && onInsert && (
                            <Button type="button" onClick={handleInsert}>
                                <ArrowRight size={16} />
                                {t('app.htaccessConverter.insertIntoRules', 'Insert into rules')}
                            </Button>
                        )}
                    </div>
                )}
            >
                <div className="htaccess-converter">
                    <p className="htaccess-converter__hint">
                        {t('app.htaccessConverter.pasteTheContentsOfAnApache', 'Paste the contents of an Apache')} <code>.htaccess</code> {t('app.htaccessConverter.fileEGFromAnImported', 'file (e.g. from an imported cPanel site). Rewrites, redirects, access rules and basic auth are translated to nginx directives for the custom rules box; anything that has no equivalent is listed below instead of being dropped.')}
                    </p>

                    <Textarea
                        className="htaccess-converter__input"
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                        placeholder={t('app.htaccessConverter.rewriteengineOnRewritecondRequestFilenameF', 'RewriteEngine On\nRewriteCond %{REQUEST_FILENAME} !-f\nRewriteCond %{REQUEST_FILENAME} !-d\nRewriteRule . /index.php [L]')}
                        rows={8}
                        spellCheck={false}
                    />

                    <div className="htaccess-converter__actions">
                        <Button
                            type="button"
                            onClick={handleConvert}
                            disabled={!source.trim() || converting}
                        >
                            {converting ? t('app.htaccessConverter.converting', 'Converting…') : t('app.htaccessConverter.convert', 'Convert')}
                        </Button>
                    </div>

                    {result && (
                        <div className="htaccess-converter__result">
                            <div className="htaccess-converter__pane">
                                <div className="htaccess-converter__pane-header">
                                    <span>{t('app.htaccessConverter.nginxDirectives', 'nginx directives')}</span>
                                    {result.nginx && <CopyButton value={result.nginx} size="sm" variant="ghost" label={t('app.htaccessConverter.copyNginxRules', 'Copy nginx rules')} />}
                                </div>
                                {result.nginx ? (
                                    <pre className="htaccess-converter__output"><code>{result.nginx}</code></pre>
                                ) : (
                                    <p className="htaccess-converter__empty">{t('app.htaccessConverter.noTranslatableDirectivesFound', 'No translatable directives found.')}</p>
                                )}
                            </div>

                            {notes.length > 0 && (
                                <div className="htaccess-converter__pane">
                                    <div className="htaccess-converter__pane-header">
                                        <span>{t('app.htaccessConverter.notes', 'Notes')}</span>
                                    </div>
                                    <ul className="htaccess-converter__notes">
                                        {notes.map((note) => (
                                            <li key={note}>{note}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {unsupported.length > 0 && (
                                <div className="htaccess-converter__pane htaccess-converter__pane--warn">
                                    <div className="htaccess-converter__pane-header">
                                        <AlertTriangle size={15} />
                                        <span>{t('app.htaccessConverter.notTranslated', 'Not translated (')}{unsupported.length})</span>
                                    </div>
                                    <div className="htaccess-converter__table-wrap">
                                        <table className="htaccess-converter__table">
                                            <thead>
                                                <tr>
                                                    <th>{t('app.htaccessConverter.line', 'Line')}</th>
                                                    <th>{t('app.htaccessConverter.directive', 'Directive')}</th>
                                                    <th>{t('app.htaccessConverter.reason', 'Reason')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {unsupported.map((item) => (
                                                    <tr key={`${item.line}-${item.directive}`}>
                                                        <td>{item.line}</td>
                                                        <td><code>{item.directive}</code></td>
                                                        <td>{item.reason}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Modal>
        </>
    );
}
