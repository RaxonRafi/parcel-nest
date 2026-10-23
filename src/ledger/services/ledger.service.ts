import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction, AuditTargetType } from '../../audit/types/audit.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Paginated, paginate } from '../../common/types/paginated.type';
import { round2 } from '../../parcel/utils/pricing.util';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../user/types/user.types';
import { CourierDepositDto, MerchantPayoutDto } from '../dto/ledger-action.dto';
import { QueryBalancesDto } from '../dto/query-balances.dto';
import { LedgerEntry } from '../entities/ledger-entry.entity';
import {
  FEE_CHARGE_TYPES,
  LedgerAccountType,
  LedgerBalanceRow,
  LedgerDraft,
  LedgerEntryType,
} from '../types/ledger.types';

/** One line of a statement — no nested user records. */
export interface LedgerEntryView {
  id: string;
  type: LedgerEntryType;
  amount: number;
  trackingId: string | null;
  note: string | null;
  reference: string | null;
  createdAt: Date;
}

export interface LedgerStatement {
  accountType: LedgerAccountType;
  userId: string;
  name: string;
  balance: number;
  entries: Paginated<LedgerEntryView>;
}

/**
 * Sole owner of `ledger_entries`.
 *
 * Parcel and payment code never insert rows themselves: they build drafts and
 * hand them to `post` together with their own transaction's manager, so a
 * parcel never changes state without its money moving in the same commit.
 */
@Injectable()
export class LedgerService {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepository: Repository<LedgerEntry>,
    private readonly auditService: AuditService,
  ) {}

  /** Saves drafts inside the caller's transaction. */
  async post(manager: EntityManager, drafts: LedgerDraft[]): Promise<void> {
    if (!drafts.length) return;

    await manager.save(
      drafts.map((draft) =>
        manager.create(LedgerEntry, {
          accountType: draft.accountType,
          account: { id: draft.accountId },
          type: draft.type,
          amount: round2(draft.amount),
          parcel: draft.parcelId ? { id: draft.parcelId } : null,
          trackingId: draft.trackingId ?? null,
          note: draft.note ?? null,
          reference: draft.reference ?? null,
          createdBy: draft.createdById ? { id: draft.createdById } : null,
        }),
      ),
    );
  }

  /**
   * The fee currently charged for a parcel, as the (negative) sum of its fee
   * entries — what a cancellation has to give back.
   */
  async feeChargedFor(
    manager: EntityManager,
    parcelId: string,
  ): Promise<number> {
    const row = await manager
      .createQueryBuilder(LedgerEntry, 'entry')
      .select('COALESCE(SUM(entry.amount), 0)', 'total')
      .where('entry.parcelId = :parcelId', { parcelId })
      .andWhere('entry.accountType = :accountType', {
        accountType: LedgerAccountType.MERCHANT,
      })
      .andWhere({ type: In([...FEE_CHARGE_TYPES]) })
      .getRawOne<{ total: string | number }>();

    return round2(Number(row?.total ?? 0));
  }

  async balanceOf(
    accountType: LedgerAccountType,
    userId: string,
    manager: EntityManager = this.ledgerRepository.manager,
  ): Promise<number> {
    const row = await manager
      .createQueryBuilder(LedgerEntry, 'entry')
      .select('COALESCE(SUM(entry.amount), 0)', 'balance')
      .where('entry.accountType = :accountType', { accountType })
      .andWhere('entry.accountId = :userId', { userId })
      .getRawOne<{ balance: string | number }>();

    return round2(Number(row?.balance ?? 0));
  }

  /** A courier's account for couriers; a merchant's for everyone else. */
  accountTypeFor(user: User): LedgerAccountType {
    return user.role === Role.DELIVERY_PERSONNEL
      ? LedgerAccountType.COURIER
      : LedgerAccountType.MERCHANT;
  }

  async statement(
    accountType: LedgerAccountType,
    user: Pick<User, 'id' | 'name'>,
    query: PaginationQueryDto,
  ): Promise<LedgerStatement> {
    const [balance, [rows, total]] = await Promise.all([
      this.balanceOf(accountType, user.id),
      this.ledgerRepository.findAndCount({
        where: { accountType, account: { id: user.id } },
        order: { createdAt: 'DESC' },
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    return {
      accountType,
      userId: user.id,
      name: user.name,
      balance,
      entries: paginate(rows.map(toView), total, query.page, query.limit),
    };
  }

  /**
   * Every account of one type with its balance, largest first — the admin's
   * view of who holds cash and who is owed. Computed in Postgres.
   */
  async balances(
    accountType: LedgerAccountType,
    query: QueryBalancesDto,
  ): Promise<Paginated<LedgerBalanceRow>> {
    const having = query.outstandingOnly ? 'HAVING SUM(e.amount) <> 0' : '';

    const [rows, [{ count }]] = await Promise.all([
      this.ledgerRepository.query<
        {
          userId: string;
          name: string;
          email: string;
          balance: string | number;
          entries: string | number;
        }[]
      >(
        `SELECT u.id AS "userId", u.name AS name, u.email AS email,
                SUM(e.amount) AS balance, COUNT(*) AS entries
           FROM ledger_entries e
           JOIN users u ON u.id = e."accountId"
          WHERE e."accountType" = $1
          GROUP BY u.id, u.name, u.email
          ${having}
          ORDER BY SUM(e.amount) DESC, u.name ASC
          LIMIT $2 OFFSET $3`,
        [accountType, query.limit, query.skip],
      ),
      this.ledgerRepository.query<{ count: string | number }[]>(
        `SELECT COUNT(*) AS count FROM (
           SELECT e."accountId" FROM ledger_entries e
            WHERE e."accountType" = $1
            GROUP BY e."accountId"
            ${having}
         ) accounts`,
        [accountType],
      ),
    ]);

    return paginate(
      rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        email: row.email,
        balance: round2(Number(row.balance)),
        entries: Number(row.entries),
      })),
      Number(count),
      query.page,
      query.limit,
    );
  }

  /**
   * A courier handing collected cash in at the hub. Refused above what they
   * hold, so a typo cannot leave a courier "owed" money they never had.
   */
  async recordDeposit(
    courier: User,
    payload: CourierDepositDto,
    admin: User,
  ): Promise<LedgerStatement> {
    if (courier.role !== Role.DELIVERY_PERSONNEL) {
      throw new BadRequestException('That account is not a courier');
    }

    await this.withdraw(
      LedgerAccountType.COURIER,
      courier,
      payload.amount,
      'This courier holds',
      (manager) =>
        this.post(manager, [
          {
            accountType: LedgerAccountType.COURIER,
            accountId: courier.id,
            type: LedgerEntryType.COD_DEPOSIT,
            amount: -payload.amount,
            note: payload.note ?? null,
            reference: payload.reference ?? null,
            createdById: admin.id,
          },
        ]),
    );
    await this.auditService.record({
      actor: admin,
      action: AuditAction.COD_DEPOSIT_RECORDED,
      targetType: AuditTargetType.USER,
      targetId: courier.id,
      summary: `${courier.name} handed in ${payload.amount}`,
      metadata: { amount: payload.amount, reference: payload.reference },
    });

    return this.statement(LedgerAccountType.COURIER, courier, new PaginationQueryDto());
  }

  /** Money sent to a merchant. Refused above what they are owed. */
  async recordPayout(
    merchant: User,
    payload: MerchantPayoutDto,
    admin: User,
  ): Promise<LedgerStatement> {
    await this.withdraw(
      LedgerAccountType.MERCHANT,
      merchant,
      payload.amount,
      'This merchant is owed',
      (manager) =>
        this.post(manager, [
          {
            accountType: LedgerAccountType.MERCHANT,
            accountId: merchant.id,
            type: LedgerEntryType.PAYOUT,
            amount: -payload.amount,
            note: [payload.method, payload.note].filter(Boolean).join(' — '),
            reference: payload.reference ?? null,
            createdById: admin.id,
          },
        ]),
    );
    await this.auditService.record({
      actor: admin,
      action: AuditAction.PAYOUT_RECORDED,
      targetType: AuditTargetType.USER,
      targetId: merchant.id,
      summary: `Paid ${payload.amount} to ${merchant.name} by ${payload.method}`,
      metadata: {
        amount: payload.amount,
        method: payload.method,
        reference: payload.reference,
      },
    });

    return this.statement(LedgerAccountType.MERCHANT, merchant, new PaginationQueryDto());
  }

  /**
   * Checks the balance and writes the entry in one transaction, holding a
   * lock on the account's user row so two admins recording at once cannot
   * both spend the same balance.
   */
  private async withdraw(
    accountType: LedgerAccountType,
    account: User,
    amount: number,
    label: string,
    write: (manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    await this.ledgerRepository.manager.transaction(async (manager) => {
      const locked = await manager.findOne(User, {
        where: { id: account.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new NotFoundException('Account not found');
      }

      const balance = await this.balanceOf(accountType, account.id, manager);
      if (amount > balance) {
        throw new BadRequestException(
          `${label} ${balance} — cannot record ${amount}`,
        );
      }

      await write(manager);
    });
  }
}

function toView(entry: LedgerEntry): LedgerEntryView {
  return {
    id: entry.id,
    type: entry.type,
    amount: entry.amount,
    trackingId: entry.trackingId,
    note: entry.note,
    reference: entry.reference,
    createdAt: entry.createdAt,
  };
}
