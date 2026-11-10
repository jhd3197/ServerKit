import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../src/components/ui/button';
import { Card, CardHeader, CardContent } from '../../src/components/ui/card';
import '../../src/styles/main.scss';

window.controlEvents = { submits: 0, clicks: 0 };
const submit = (event) => { event.preventDefault(); window.controlEvents.submits += 1; };
const click = () => { window.controlEvents.clicks += 1; };
export const NativeButton = (props) => createElement('button', props);

createRoot(document.getElementById('root')).render(
    <>
        <form onSubmit={submit}>
            <NativeButton id="native-submit" className="btn btn-primary">Submit</NativeButton>
            <Button id="shared-submit" variant="primary" className="btn btn-primary">Submit</Button>
            <NativeButton id="native-custom" type="button" className="shell-panel__action">Action</NativeButton>
            <Button id="shared-custom" type="button" variant="unstyled" className="shell-panel__action"
                ref={(node) => { window.controlRef = node; }} onClick={click}>Action</Button>
            <NativeButton id="native-disabled" type="button" className="btn btn-secondary" disabled>Disabled</NativeButton>
            <Button id="shared-disabled" type="button" variant="outline" className="btn btn-secondary" disabled onClick={click}>Disabled</Button>
            <Button id="shared-reason" variant="outline" disabled disabledReason="Install it first" onClick={click}>Reasoned</Button>
        </form>
        <Button asChild variant="unstyled"><a id="shared-link" href="#destination">Link</a></Button>
        {createElement('div', { id: 'native-card', className: 'card' },
            createElement('div', { id: 'native-header', className: 'card-header' }, 'Header'),
            createElement('div', { id: 'native-content', className: 'card-body' }, 'Content'))}
        <Card id="shared-card" variant="legacy" className="card">
            <CardHeader id="shared-header" variant="legacy" className="card-header">Header</CardHeader>
            <CardContent id="shared-content" variant="legacy" className="card-body">Content</CardContent>
        </Card>
    </>,
);
