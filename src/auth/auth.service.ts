import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabase: SupabaseService,
  ) {}

  async login(email: string, password: string) {
    if (!email || !password) {
      throw new BadRequestException(
        'email and password are required',
      );
    }

    const client = this.supabase.getAuthClient();

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      throw new BadRequestException(
        'Invalid email or password',
      );
    }

    const profile = await this.getAuthenticatedProfile(
      data.user.id,
    );

    if (!profile) {
      throw new InternalServerErrorException(
        'User profile not found',
      );
    }

    if (profile.status !== 'ACTIVE') {
      throw new BadRequestException(
        'User account is not active',
      );
    }

    return {
      success: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      profile,
    };
  }


  async resetUserPassword(
    targetUserId: string,
    newPassword: string,
  ) {
    if (!targetUserId || !newPassword) {
      throw new BadRequestException(
        'targetUserId and newPassword are required',
      );
    }

    if (newPassword.length < 8) {
      throw new BadRequestException(
        'Password must contain at least 8 characters',
      );
    }

    const client = this.supabase.getClient();

    const {
      data: targetProfile,
      error: targetError,
    } = await client
      .from('users')
      .select('id, user_code, role, status, email')
      .eq('id', targetUserId)
      .maybeSingle();

    if (targetError) {
      throw new InternalServerErrorException(
        targetError.message,
      );
    }

    if (!targetProfile) {
      throw new NotFoundException(
        'Target user profile not found',
      );
    }

    if (targetProfile.role === 'OWNER') {
      throw new ForbiddenException(
        'OWNER password cannot be reset by this endpoint',
      );
    }

    const {
      data,
      error,
    } = await client.auth.admin.updateUserById(
      targetUserId,
      {
        password: newPassword,
      },
    );

    if (error) {
      throw new BadRequestException(
        'Unable to reset user password',
      );
    }

    return {
      success: true,
      message: 'User password reset successfully',
      user: {
        id: targetProfile.id,
        user_code: targetProfile.user_code,
        role: targetProfile.role,
        email: targetProfile.email,
        status: targetProfile.status,
      },
      auth_user_id:
        data.user?.id ?? targetUserId,
    };
  }

  async getUserFromToken(accessToken: string) {
    const { data, error } = await this.supabase
      .getAuthClient()
      .auth
      .getUser(accessToken);

    if (error || !data.user) {
      return null;
    }

    return data.user;
  }

  async getAuthenticatedProfile(userId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('users')
      .select('id, user_code, role, created_by, full_name, email, status')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  async bootstrapOwner(
    email: string,
    password: string,
    fullName: string,
  ) {
    if (!email || !password || !fullName) {
      throw new BadRequestException(
        'email, password and fullName are required',
      );
    }

    if (password.length < 8) {
      throw new BadRequestException(
        'Password must contain at least 8 characters',
      );
    }

    const client = this.supabase.getClient();

    // Only allow bootstrap when no OWNER exists.
    const { data: existingOwner, error: ownerCheckError } =
      await client
        .from('users')
        .select('id')
        .eq('role', 'OWNER')
        .limit(1);

    if (ownerCheckError) {
      throw new InternalServerErrorException(
        ownerCheckError.message,
      );
    }

    if (existingOwner && existingOwner.length > 0) {
      throw new BadRequestException(
        'OWNER already exists',
      );
    }

    // Create Supabase Auth user.
    const { data: authData, error: authError } =
      await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError || !authData.user) {
      throw new BadRequestException(
        authError?.message ?? 'Failed to create Auth user',
      );
    }

    const userId = authData.user.id;

    // Create application profile.
    const { data: profile, error: profileError } =
      await client
        .from('users')
        .insert({
          id: userId,
          user_code: `OWN-${userId.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
          role: 'OWNER',
          created_by: null,
          full_name: fullName,
          email,
          status: 'ACTIVE',
        })
        .select()
        .single();

    if (profileError) {
      // Roll back Auth user if profile creation fails.
      await client.auth.admin.deleteUser(userId);

      throw new InternalServerErrorException(
        profileError.message,
      );
    }

    return {
      success: true,
      message: 'OWNER created successfully',
      user: profile,
    };
  }
}
