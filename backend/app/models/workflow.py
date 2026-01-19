from datetime import datetime
from app import db


class Workflow(db.Model):
    __tablename__ = 'workflows'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)

    # React Flow state stored as JSON strings
    nodes = db.Column(db.Text, nullable=True)  # JSON array of nodes
    edges = db.Column(db.Text, nullable=True)  # JSON array of edges
    viewport = db.Column(db.Text, nullable=True)  # JSON object {x, y, zoom}

    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Foreign keys
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

    # Relationships
    user = db.relationship('User', backref=db.backref('workflows', lazy='dynamic'))

    def to_dict(self):
        import json
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'nodes': json.loads(self.nodes) if self.nodes else [],
            'edges': json.loads(self.edges) if self.edges else [],
            'viewport': json.loads(self.viewport) if self.viewport else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'user_id': self.user_id,
            'node_count': len(json.loads(self.nodes)) if self.nodes else 0,
            'edge_count': len(json.loads(self.edges)) if self.edges else 0
        }

    def __repr__(self):
        return f'<Workflow {self.name}>'
