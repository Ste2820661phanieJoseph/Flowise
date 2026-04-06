/**
 * Manual mock for 'typeorm'.
 * All decorator factories are replaced with no-ops so TypeORM entity classes
 * can be defined in tests without a real database connection.
 * Used by all server-package test files via jest.mock('typeorm').
 */

const decorator = (): (() => void) => () => {}

module.exports = {
    Column: decorator,
    Entity: decorator,
    PrimaryGeneratedColumn: decorator,
    PrimaryColumn: decorator,
    CreateDateColumn: decorator,
    UpdateDateColumn: decorator,
    Index: decorator,
    ManyToOne: decorator,
    OneToMany: decorator,
    OneToOne: decorator,
    JoinColumn: decorator,
    Unique: decorator,
    DataSource: jest.fn()
}
