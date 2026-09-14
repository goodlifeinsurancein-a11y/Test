import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { AuthService } from '../auth/auth.service.js';

type UserRole = 'OWNER' | 'SUPER_ADMIN' | 'ADMIN' | 'PLAYER';

type UserProfile = {
  id: string;
  user_code: string;
  role: UserRole;
  created_by: string | null;
  full_name: string;
  email: string;
  status: string;
};

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService, private readonly authService: AuthService) {}

  private getNextRole(role: UserRole): UserRole {
    switch (role) {
      case 'OWNER': return 'SUPER_ADMIN';
      case 'SUPER_ADMIN': return 'ADMIN';
      case 'ADMIN': return 'PLAYER';
      default: throw new ForbiddenException('PLAYER cannot create users');
    }
  }

  private generateUserCode(role: UserRole, userId: string): string {
    const prefix = { OWNER: 'OWN', SUPER_ADMIN: 'SAD', ADMIN: 'ADM', PLAYER: 'PLY' }[role];
    return `${prefix}-${userId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  }

  private generateWalletId(userId: string): string {
    return `WAL-${userId.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  }

  private async getProfile(userId: string): Promise<UserProfile> {
    const { data, error } = await this.supabase.getClient()
      .from('users').select('id, user_code, role, created_by, full_name, email, status')
      .eq('id', userId).maybeSingle();
    if (error) throw new InternalServerErrorException('Unable to load user profile');
    if (!data) throw new NotFoundException('User profile not found');
    return data as UserProfile;
  }

  private async canManageUser(actor: UserProfile, target: UserProfile): Promise<boolean> {
    if (actor.id === target.id || target.role === 'OWNER') return false;
    if (actor.role === 'OWNER') return true;
    if (actor.role === 'PLAYER') return false;

    if (target.created_by === actor.id) {
      if (actor.role === 'SUPER_ADMIN') return target.role === 'ADMIN';
      if (actor.role === 'ADMIN') return target.role === 'PLAYER';
    }

    if (actor.role === 'SUPER_ADMIN' && target.role === 'PLAYER') {
      let currentId = target.created_by;
      const visited = new Set<string>();
      while (currentId) {
        if (visited.has(currentId)) return false;
        visited.add(currentId);
        const parent = await this.getProfile(currentId);
        // Valid chain: PLAYER -> ADMIN -> this SUPER_ADMIN.
        if (parent.id === actor.id && parent.role === 'SUPER_ADMIN') return true;
        if (parent.role === 'SUPER_ADMIN' || parent.role === 'OWNER') return false;
        currentId = parent.created_by;
      }
    }
    return false;
  }

  async createUser(creatorId: string, dto: CreateUserDto) {
    if (!creatorId) throw new BadRequestException('Creator ID is required');
    if (!dto.email || !dto.password || !dto.fullName) throw new BadRequestException('email, password and fullName are required');
    if (dto.password.length < 8) throw new BadRequestException('Password must contain at least 8 characters');
    const client = this.supabase.getClient();
    const creator = await this.getProfile(creatorId);
    if (creator.status !== 'ACTIVE') throw new ForbiddenException('Creator account is not active');
    const newRole = this.getNextRole(creator.role);
    const { data: authData, error: authError } = await client.auth.admin.createUser({ email: dto.email, password: dto.password, email_confirm: true });
    if (authError || !authData.user) throw new BadRequestException(authError?.message ?? 'Failed to create Auth user');
    const userId = authData.user.id;
    const userCode = this.generateUserCode(newRole, userId);
    const { data: profile, error: profileError } = await client.rpc('create_user_profile', {
      p_id: userId, p_user_code: userCode, p_role: newRole, p_created_by: creatorId,
      p_full_name: dto.fullName, p_email: dto.email, p_status: 'ACTIVE',
    });
    if (profileError || !profile) {
      await client.auth.admin.deleteUser(userId);
      throw new InternalServerErrorException('Failed to create user profile');
    }
    const { data: wallet, error: walletError } = await client.rpc('create_user_wallet', {
      p_wallet_id: this.generateWalletId(userId), p_user_id: userId, p_balance: 0, p_version: 1,
    });
    if (walletError || !wallet) {
      await client.from('users').delete().eq('id', userId);
      await client.auth.admin.deleteUser(userId);
      throw new InternalServerErrorException('Failed to create user wallet');
    }
    return { success: true, message: `${newRole} created successfully`, user: {
      id: profile.id, user_code: profile.user_code, role: profile.role, created_by: profile.created_by,
      full_name: profile.full_name, email: profile.email, status: profile.status,
    }, wallet };
  }

  async listManagedUsers(actorId: string) {
    const actor = await this.getProfile(actorId);
    if (actor.status !== 'ACTIVE') throw new ForbiddenException('User account is not active');
    if (actor.role === 'PLAYER') throw new ForbiddenException('PLAYER cannot access user management');
    const { data: users, error } = await this.supabase.getClient().from('users')
      .select('id, user_code, role, created_by, full_name, email, status').neq('role', 'OWNER').order('created_at', { ascending: true });
    if (error) throw new InternalServerErrorException('Unable to list users');
    const result: UserProfile[] = [];
    for (const user of users ?? []) if (await this.canManageUser(actor, user as UserProfile)) result.push(user as UserProfile);
    return { success: true, users: result };
  }

  async getManagedUser(actorId: string, targetUserId: string) {
    const actor = await this.getProfile(actorId);
    if (actor.status !== 'ACTIVE') throw new ForbiddenException('User account is not active');
    const target = await this.getProfile(targetUserId);
    if (!(await this.canManageUser(actor, target))) throw new ForbiddenException('You do not have permission to manage this user');
    return { success: true, user: target };
  }

  async updateUser(actorId: string, targetUserId: string, dto: import('./dto/update-user.dto.js').UpdateUserDto) {
    const actor = await this.getProfile(actorId);
    if (actor.status !== 'ACTIVE') throw new ForbiddenException('User account is not active');
    const target = await this.getProfile(targetUserId);
    if (!(await this.canManageUser(actor, target))) throw new ForbiddenException('You do not have permission to manage this user');
    const fullName = dto.fullName?.trim();
    const email = dto.email?.trim().toLowerCase();
    if (!fullName && !email) throw new BadRequestException('At least fullName or email is required');
    if (fullName !== undefined && fullName.length < 2) throw new BadRequestException('fullName must contain at least 2 characters');
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Invalid email address');
    const client = this.supabase.getClient();
    if (email && email !== target.email.toLowerCase()) {
      const { error: authError } = await client.auth.admin.updateUserById(target.id, { email, email_confirm: true });
      if (authError) throw new BadRequestException(authError.message);
    }
    const updates: Record<string, string> = {};
    if (fullName !== undefined) updates.full_name = fullName;
    if (email !== undefined) updates.email = email;
    const { error } = await client.from('users').update(updates).eq('id', target.id);
    if (error) throw new InternalServerErrorException('Failed to update user profile');
    return { success: true, message: 'User profile updated successfully', user: await this.getProfile(target.id) };
  }

  async resetUserPassword(actorId: string, targetUserId: string, newPassword: string) {
    const actor = await this.getProfile(actorId);
    if (actor.status !== 'ACTIVE') throw new ForbiddenException('User account is not active');
    if (actor.role === 'PLAYER') throw new ForbiddenException('PLAYER cannot reset user passwords');
    const target = await this.getProfile(targetUserId);
    if (!(await this.canManageUser(actor, target))) throw new ForbiddenException('You do not have permission to reset this user password');
    return this.authService.resetUserPassword(target.id, newPassword);
  }

  async updateUserStatus(actorId: string, targetUserId: string, status: 'ACTIVE' | 'INACTIVE') {
    if (status !== 'ACTIVE' && status !== 'INACTIVE') throw new BadRequestException('Status must be ACTIVE or INACTIVE');
    const actor = await this.getProfile(actorId);
    if (actor.status !== 'ACTIVE') throw new ForbiddenException('User account is not active');
    const target = await this.getProfile(targetUserId);
    if (!(await this.canManageUser(actor, target))) throw new ForbiddenException('You do not have permission to manage this user');
    const { error } = await this.supabase.getClient().from('users').update({ status }).eq('id', target.id);
    if (error) throw new InternalServerErrorException('Failed to update user status');
    return { success: true, message: 'User status updated successfully', user: await this.getProfile(target.id) };
  }
}
