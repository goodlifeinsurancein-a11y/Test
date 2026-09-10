import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from './app.controller.js';
import { SupabaseService } from './supabase/supabase.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: SupabaseService,
          useValue: {},
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toEqual({
        success: true,
        message: 'NestJS Backend Running',
      });
    });
  });
});
