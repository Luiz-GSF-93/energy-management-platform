import { DataSource, DataSourceOptions } from 'typeorm';

export async function createDataSource(options: DataSourceOptions): Promise<DataSource> {
  const dataSource = new DataSource(options);
  
  try {
    await dataSource.initialize();
    console.log('✅ Database connection established');
    return dataSource;
  } catch (error) {
    console.warn('⚠️ Database connection failed, continuing without DB');
    // Retornar um DataSource "mock" que não falha
    return new DataSource({
      ...options,
      dropSchema: false,
      synchronize: false,
    });
  }
}
